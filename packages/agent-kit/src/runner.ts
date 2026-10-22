import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { AgentApi, AgentTaskSummary, LinkedProject } from './agent-api.js';
import { buildPrompt, claudeArgs, mcpConfig, parseStreamLine, toolLabel, truncate, type RunSummary } from './claude.js';
import type { Workdir } from './workdir.js';

// The runner: watches Bishop for queued work in this agent's linked projects,
// claims it, runs Claude Code on it, and keeps Bishop informed. All side
// effects come in through `deps`, so the scheduling logic is testable.

export interface ChildLike {
  stdout: Readable;
  stderr: Readable;
  stdin: { end(data?: string): void };
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
}

export type Api = Pick<
  AgentApi,
  | 'listLinks'
  | 'listTasks'
  | 'claim'
  | 'renew'
  | 'setStatus'
  | 'addEvent'
  | 'getTask'
  | 'reclaimExpired'
  | 'heartbeat'
>;

export interface RunnerDeps {
  api: Api;
  prepareWorkdir(opts: { linkedPath: string; taskId: string; title: string }): Promise<Workdir>;
  spawnClaude(opts: { cwd: string; args: string[] }): ChildLike;
  writeMcpConfig(taskId: string, config: unknown): Promise<string>;
  removeMcpConfig(path: string): Promise<void>;
  log(message: string): void;
}

export interface RunnerOptions {
  agentId: string;
  mac: string;
  maxConcurrent: number;
  capabilities: string[];
  nodePath: string;
  mcpScript: string;
  mcpEnv?: Record<string, string>;
  claudeExtraArgs?: string[];
  leaseSeconds?: number;
  renewEveryMs?: number;
  flushEveryMs?: number;
  pollEveryMs?: number;
  heartbeatEveryMs?: number;
}

interface Run {
  task: AgentTaskSummary;
  link: LinkedProject;
  child: ChildLike | null;
  workdir: Workdir | null;
  mcpPath: string | null;
  renewTimer: NodeJS.Timeout | null;
  flushTimer: NodeJS.Timeout | null;
  pendingText: string | null;
  tools: Set<string>;
  summary: RunSummary | null;
  stderrTail: string[];
  /** Why we stopped it, if we did. */
  stopReason: 'user_changed' | 'lease_lost' | 'shutdown' | null;
  finished: boolean;
  done: Promise<void>;
  resolveDone: () => void;
}

const USER_TOOK_BACK = new Set(['todo', 'done', 'inbox']);

export class Runner {
  readonly running = new Map<string, Run>();
  paused = false;
  private stopping = false;
  private ticking: Promise<void> | null = null;
  private tickAgain = false;
  private timers: NodeJS.Timeout[] = [];
  private readonly o: Required<Omit<RunnerOptions, 'mcpEnv' | 'claudeExtraArgs'>> &
    Pick<RunnerOptions, 'mcpEnv' | 'claudeExtraArgs'>;

  constructor(
    private readonly deps: RunnerDeps,
    opts: RunnerOptions,
  ) {
    this.o = {
      leaseSeconds: 120,
      renewEveryMs: 30_000,
      flushEveryMs: 15_000,
      pollEveryMs: 30_000,
      heartbeatEveryMs: 30_000,
      ...opts,
    };
  }

  /** Begin polling and heart-beating. Live updates call requestTick() for instant pickup. */
  start(): void {
    void this.heartbeat();
    this.requestTick();
    this.timers.push(setInterval(() => this.requestTick(), this.o.pollEveryMs));
    this.timers.push(setInterval(() => void this.heartbeat(), this.o.heartbeatEveryMs));
  }

  private async heartbeat() {
    try {
      await this.deps.api.heartbeat(this.o.capabilities, this.o.mac);
    } catch (e) {
      this.deps.log(`heartbeat failed: ${(e as Error).message}`);
    }
  }

  /** Ask for a scheduling pass. Calls arriving mid-pass coalesce into one more pass. */
  requestTick(): Promise<void> {
    if (this.ticking) {
      this.tickAgain = true;
      return this.ticking;
    }
    this.ticking = (async () => {
      do {
        this.tickAgain = false;
        try {
          await this.tick();
        } catch (e) {
          this.deps.log(`scheduling pass failed: ${(e as Error).message}`);
        }
      } while (this.tickAgain && !this.stopping);
      this.ticking = null;
    })();
    return this.ticking;
  }

  /** One scheduling pass. */
  async tick(): Promise<void> {
    if (this.stopping) return;
    const { api } = this.deps;
    const reclaimed = await api.reclaimExpired().catch(() => 0);
    if (reclaimed) this.deps.log(`re-queued ${reclaimed} task(s) whose agent stopped responding`);

    const [links, tasks] = await Promise.all([api.listLinks(), api.listTasks()]);
    const byProject = new Map(links.filter((l) => l.project_status === 'active').map((l) => [l.project_id, l]));
    const byId = new Map(tasks.map((t) => [t.id, t]));

    // Stop runs you took back (moved to To do, Done or Inbox) while they ran.
    for (const [id, run] of this.running) {
      const now = byId.get(id);
      const status = now?.status ?? 'todo'; // gone from the list = no longer agent work
      if (USER_TOOK_BACK.has(status) && !run.stopReason) {
        this.stop(run, 'user_changed');
      }
    }

    if (this.paused) return;
    let capacity = this.o.maxConcurrent - this.running.size;
    for (const task of tasks) {
      if (capacity <= 0) break;
      if (task.status !== 'queued' || this.running.has(task.id)) continue;
      const link = task.project_id ? byProject.get(task.project_id) : undefined;
      if (!link) continue;
      if (!(await api.claim(task.id, this.o.leaseSeconds))) continue;
      capacity -= 1;
      this.begin({ ...task, status: 'in_progress' }, link);
    }
  }

  private begin(task: AgentTaskSummary, link: LinkedProject): void {
    let resolveDone!: () => void;
    const run: Run = {
      task,
      link,
      child: null,
      workdir: null,
      mcpPath: null,
      renewTimer: null,
      flushTimer: null,
      pendingText: null,
      tools: new Set(),
      summary: null,
      stderrTail: [],
      stopReason: null,
      finished: false,
      done: new Promise<void>((r) => (resolveDone = r)),
      resolveDone: () => resolveDone(),
    };
    this.running.set(task.id, run);
    void this.launch(run);
  }

  private async launch(run: Run): Promise<void> {
    const { api } = this.deps;
    const { task, link } = run;
    try {
      run.workdir = await this.deps.prepareWorkdir({ linkedPath: link.local_path, taskId: task.id, title: task.title });
      const bundle = await api.getTask(task.id);
      const isRerun = bundle.thread.some((e) => e.by === 'agent' && e.kind !== 'status');
      run.mcpPath = await this.deps.writeMcpConfig(
        task.id,
        mcpConfig(this.o.nodePath, this.o.mcpScript, { BISHOP_TASK_ID: task.id, ...(this.o.mcpEnv ?? {}) }),
      );
      const where = run.workdir.branch ? `${run.workdir.path} (branch ${run.workdir.branch})` : run.workdir.path;
      await api.addEvent(task.id, 'run_log', `Started on ${this.o.mac}${isRerun ? ', continuing from the thread' : ''}. Working in ${where}.`);

      const child = this.deps.spawnClaude({ cwd: run.workdir.path, args: claudeArgs(run.mcpPath, this.o.claudeExtraArgs) });
      run.child = child;
      child.stdin.end(
        buildPrompt({
          taskId: task.id,
          title: task.title,
          projectName: link.project_name,
          workdir: run.workdir.path,
          branch: run.workdir.branch,
          isRerun,
        }),
      );
      createInterface({ input: child.stdout }).on('line', (line) => this.onLine(run, line));
      createInterface({ input: child.stderr }).on('line', (line) => {
        run.stderrTail.push(line);
        if (run.stderrTail.length > 20) run.stderrTail.shift();
      });
      child.on('error', (err) => {
        // e.g. the claude command isn't installed: there may be no 'exit' event.
        run.stderrTail.push(err.message);
        void this.finish(run, null, null);
      });
      child.on('exit', (code, signal) => void this.finish(run, code, signal));

      run.renewTimer = setInterval(() => void this.renew(run), this.o.renewEveryMs);
      run.flushTimer = setInterval(() => void this.flush(run), this.o.flushEveryMs);
      this.deps.log(`started ${task.title} (${task.id})`);
    } catch (e) {
      const message = (e as Error).message;
      this.deps.log(`could not start ${task.id}: ${message}`);
      await api.setStatus(task.id, 'failed', `Couldn't start on ${this.o.mac}: ${message}`).catch(() => {});
      await this.cleanup(run);
    }
  }

  private onLine(run: Run, line: string): void {
    for (const note of parseStreamLine(line)) {
      if (note.type === 'text') run.pendingText = note.text;
      else if (note.type === 'tool') run.tools.add(toolLabel(note.name));
      else if (note.type === 'result') run.summary = note.summary;
      else if (note.type === 'init' && note.mcpErrors.length) {
        void this.deps.api.addEvent(run.task.id, 'run_log', `Some tools failed to load: ${truncate(JSON.stringify(note.mcpErrors), 400)}`).catch(() => {});
      }
    }
  }

  /** Post the latest thing Claude said, at most once per flush interval. */
  private async flush(run: Run): Promise<void> {
    if (!run.pendingText) return;
    const body = truncate(run.pendingText, 600);
    run.pendingText = null;
    await this.deps.api.addEvent(run.task.id, 'run_log', body, { tools: [...run.tools] }).catch(() => {});
  }

  private async renew(run: Run): Promise<void> {
    try {
      const ok = await this.deps.api.renew(run.task.id, this.o.leaseSeconds);
      // The agent may have moved its own task to review or blocked; that's fine.
      if (!ok) {
        const now = (await this.deps.api.listTasks()).find((t) => t.id === run.task.id);
        if (!now || USER_TOOK_BACK.has(now.status)) this.stop(run, 'user_changed');
        else if (now.status === 'queued' && !run.stopReason) this.stop(run, 'lease_lost');
      }
    } catch (e) {
      this.deps.log(`lease renewal failed for ${run.task.id}: ${(e as Error).message}`);
    }
  }

  private stop(run: Run, reason: NonNullable<Run['stopReason']>): void {
    run.stopReason = reason;
    this.deps.log(`stopping ${run.task.id}: ${reason}`);
    // SIGINT lets Claude finish its turn cleanly; SIGTERM if it lingers.
    run.child?.kill('SIGINT');
    setTimeout(() => run.child?.kill('SIGTERM'), 15_000).unref();
  }

  private async finish(run: Run, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (run.finished) return;
    run.finished = true;
    const { api } = this.deps;
    await this.flush(run);
    try {
      const status = (await api.getTask(run.task.id)).task.status;
      const s = run.summary;
      const cost = s?.costUsd != null ? ` · ~$${s.costUsd.toFixed(2)}` : '';
      const turns = s?.turns != null ? ` · ${s.turns} turns` : '';

      if (run.stopReason === 'shutdown' && status === 'in_progress') {
        await api.setStatus(run.task.id, 'queued', `The runner on ${this.o.mac} shut down, so this went back to the queue.`);
      } else if (run.stopReason === 'user_changed' || run.stopReason === 'lease_lost') {
        await api.addEvent(run.task.id, 'run_log', 'Run stopped because the task changed in Bishop.');
      } else if (status === 'in_progress') {
        // Claude exited without moving the task on; decide for it.
        if (code === 0 && s && !s.isError) {
          const last = s.resultText ? truncate(s.resultText, 800) : 'No summary was given.';
          await api.setStatus(run.task.id, 'needs_review', `Finished. ${last}`);
        } else {
          const why = s?.subtype && s.subtype !== 'success' ? s.subtype.replace(/_/g, ' ') : signal ? `stopped by ${signal}` : `exit code ${code}`;
          const tail = run.stderrTail.slice(-5).join('\n');
          await api.setStatus(run.task.id, 'failed', `The run ended unexpectedly (${why}).${tail ? `\n${truncate(tail, 600)}` : ''}`);
        }
      }
      await api.addEvent(run.task.id, 'run_log', `Run ended${turns}${cost}.`, { exit_code: code, session_id: s?.sessionId ?? null });
    } catch (e) {
      this.deps.log(`could not record the end of ${run.task.id}: ${(e as Error).message}`);
    }
    await this.cleanup(run);
    this.deps.log(`finished ${run.task.id} (exit ${code ?? signal})`);
    if (!this.stopping) void this.requestTick();
  }

  private async cleanup(run: Run): Promise<void> {
    if (run.renewTimer) clearInterval(run.renewTimer);
    if (run.flushTimer) clearInterval(run.flushTimer);
    if (run.mcpPath) await this.deps.removeMcpConfig(run.mcpPath).catch(() => {});
    this.running.delete(run.task.id);
    run.resolveDone();
  }

  /** Stop taking work, stop running tasks, and put them back in the queue. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    const runs = [...this.running.values()];
    for (const run of runs) this.stop(run, 'shutdown');
    await Promise.all(runs.map((r) => r.done));
  }
}
