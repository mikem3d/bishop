import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AgentTaskSummary, LinkedProject, TaskBundle } from './agent-api.js';
import { Runner, type ChildLike, type RunnerDeps } from './runner.js';

// An in-memory Bishop for the runner to talk to.
class FakeBishop {
  tasks = new Map<string, AgentTaskSummary>();
  links: LinkedProject[] = [];
  events: { task: string; kind: string; body: string }[] = [];
  claims = 0;

  addTask(id: string, title: string, status = 'queued', project_id = 'p1') {
    this.tasks.set(id, {
      id, title, status, project_id, project_name: 'Shop', priority: 0, scheduled_for: null,
      lease_holder: null, lease_expires_at: null, updated_at: new Date().toISOString(),
    });
  }

  api: RunnerDeps['api'] = {
    listLinks: async () => this.links,
    listTasks: async () => [...this.tasks.values()].filter((t) => ['queued', 'in_progress', 'blocked', 'needs_review', 'failed'].includes(t.status)),
    claim: async (id) => {
      const t = this.tasks.get(id);
      if (!t || t.status !== 'queued') return false;
      this.claims += 1;
      t.status = 'in_progress';
      t.lease_holder = 'agent-1';
      return true;
    },
    renew: async (id) => this.tasks.get(id)?.status === 'in_progress',
    setStatus: async (id, status, note) => {
      const t = this.tasks.get(id)!;
      t.status = status;
      if (note) this.events.push({ task: id, kind: 'comment', body: note });
      return null;
    },
    addEvent: async (task, kind, body) => {
      this.events.push({ task, kind, body });
      return 'e';
    },
    getTask: async (id) =>
      ({
        task: { ...this.tasks.get(id)!, notes: '' },
        project: null,
        links: [],
        thread: this.events.filter((e) => e.task === id).map((e) => ({ kind: e.kind, body: e.body, created_at: '', by: 'agent' as const })),
        project_context: [],
        subtasks: [],
      }) as unknown as TaskBundle,
    reclaimExpired: async () => 0,
    heartbeat: async () => null,
  };
}

class FakeChild extends EventEmitter implements ChildLike {
  stdout = new PassThrough();
  stderr = new PassThrough();
  input = '';
  killed: string[] = [];
  stdin = { end: (data?: string) => { this.input = data ?? ''; } };
  kill(signal?: NodeJS.Signals) {
    this.killed.push(signal ?? 'SIGTERM');
    if (signal === 'SIGINT') setImmediate(() => this.exit(130, null));
    return true;
  }
  say(text: string) {
    this.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } }) + '\n');
  }
  result(ok = true, text = 'All done.') {
    this.stdout.write(JSON.stringify({ type: 'result', subtype: ok ? 'success' : 'error_during_execution', is_error: !ok, result: text, total_cost_usd: 0.12, num_turns: 7, session_id: 's1' }) + '\n');
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('exit', code, signal));
  }
}

function setup(maxConcurrent = 2) {
  const bishop = new FakeBishop();
  bishop.links = [{ project_id: 'p1', project_name: 'Shop', project_status: 'active', local_path: '/code/shop' }];
  const children: FakeChild[] = [];
  const spawned: { cwd: string; args: string[] }[] = [];
  const deps: RunnerDeps = {
    api: bishop.api,
    prepareWorkdir: async ({ taskId }) => ({ path: `/wt/${taskId}`, branch: `bishop/${taskId}`, created: true }),
    spawnClaude: (opts) => {
      spawned.push(opts);
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    writeMcpConfig: async (taskId) => `/tmp/mcp-${taskId}.json`,
    removeMcpConfig: vi.fn(async () => {}),
    log: () => {},
  };
  const runner = new Runner(deps, {
    agentId: 'agent-1', mac: 'Mac Studio', maxConcurrent, capabilities: ['code'],
    nodePath: '/usr/local/bin/node', mcpScript: '/bishop/mcp.js',
    renewEveryMs: 60_000, flushEveryMs: 60_000, pollEveryMs: 60_000, heartbeatEveryMs: 60_000,
  });
  return { bishop, runner, children, spawned, deps };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('Runner', () => {
  it('claims queued work in linked projects, up to its limit', async () => {
    const { bishop, runner, spawned } = setup(2);
    bishop.addTask('t1', 'Fix retries');
    bishop.addTask('t2', 'Add tests');
    bishop.addTask('t3', 'Third task');
    bishop.addTask('t4', 'Other project', 'queued', 'p2');
    await runner.tick();
    await settle();
    expect(runner.running.size).toBe(2);
    expect(bishop.tasks.get('t3')!.status).toBe('queued');
    expect(bishop.tasks.get('t4')!.status).toBe('queued');
    expect(spawned.map((s) => s.cwd)).toEqual(['/wt/t1', '/wt/t2']);
  });

  it('runs Claude with the Bishop MCP config and full permissions, prompt on stdin', async () => {
    const { bishop, runner, spawned, children } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    const args = spawned[0]!.args;
    expect(args).toContain('-p');
    expect(args.join(' ')).toContain('--output-format stream-json --verbose');
    expect(args.join(' ')).toContain('--permission-mode bypassPermissions');
    expect(args.slice(-2)).toEqual(['--mcp-config', '/tmp/mcp-t1.json']);
    expect(children[0]!.input).toContain('Task id: t1');
    expect(children[0]!.input).toContain('bishop/t1');
  });

  it('respects the status the agent set itself', async () => {
    const { bishop, runner, children } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    await bishop.api.setStatus('t1', 'needs_review', 'PR #12 ready');
    children[0]!.result(true);
    children[0]!.exit(0);
    await settle();
    expect(bishop.tasks.get('t1')!.status).toBe('needs_review');
    expect(runner.running.size).toBe(0);
    expect(bishop.events.some((e) => e.body.startsWith('Run ended · 7 turns · ~$0.12'))).toBe(true);
  });

  it('moves work to review when Claude finishes cleanly without saying so', async () => {
    const { bishop, runner, children } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    children[0]!.say('Working on it');
    children[0]!.result(true, 'Fixed the retry bug in checkout.ts');
    children[0]!.exit(0);
    await settle();
    expect(bishop.tasks.get('t1')!.status).toBe('needs_review');
    expect(bishop.events.some((e) => e.body.includes('Fixed the retry bug'))).toBe(true);
    expect(bishop.events.some((e) => e.kind === 'run_log' && e.body === 'Working on it')).toBe(true);
  });

  it('marks a crashed run failed with the reason', async () => {
    const { bishop, runner, children } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    children[0]!.stderr.write('Error: not logged in\n');
    children[0]!.exit(1);
    await settle();
    expect(bishop.tasks.get('t1')!.status).toBe('failed');
    expect(bishop.events.some((e) => e.body.includes('exit code 1') && e.body.includes('not logged in'))).toBe(true);
  });

  it('fails cleanly when the claude command is missing', async () => {
    const { bishop, runner, children } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    children[0]!.emit('error', new Error('spawn claude ENOENT'));
    await settle();
    expect(bishop.tasks.get('t1')!.status).toBe('failed');
    expect(runner.running.size).toBe(0);
  });

  it('stops a run when you take the task back', async () => {
    const { bishop, runner, children } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    bishop.tasks.get('t1')!.status = 'todo';
    await runner.tick();
    await settle();
    expect(children[0]!.killed).toContain('SIGINT');
    expect(bishop.tasks.get('t1')!.status).toBe('todo');
    expect(runner.running.size).toBe(0);
  });

  it('puts running work back in the queue on shutdown', async () => {
    const { bishop, runner } = setup();
    bishop.addTask('t1', 'Fix retries');
    await runner.tick();
    await settle();
    await runner.shutdown();
    expect(bishop.tasks.get('t1')!.status).toBe('queued');
    expect(bishop.events.some((e) => e.body.includes('shut down'))).toBe(true);
  });

  it('takes no new work while paused, and none from paused projects', async () => {
    const { bishop, runner } = setup();
    bishop.addTask('t1', 'Fix retries');
    runner.paused = true;
    await runner.tick();
    expect(bishop.claims).toBe(0);
    runner.paused = false;
    bishop.links[0]!.project_status = 'paused';
    await runner.tick();
    expect(bishop.claims).toBe(0);
  });

  it('coalesces bursts of change notifications into few passes', async () => {
    const { bishop, runner } = setup();
    const spy = vi.spyOn(bishop.api, 'listTasks');
    await Promise.all([runner.requestTick(), runner.requestTick(), runner.requestTick(), runner.requestTick()]);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
