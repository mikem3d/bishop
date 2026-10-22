import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentTaskSummary, TaskBundle } from './agent-api.js';
import { macDeps } from './deps.js';
import { Runner, type RunnerDeps } from './runner.js';

// The runner with its real Mac wiring (git worktree, a spawned process, the
// temp MCP config) and a stand-in `claude` script; only Bishop's API is faked.

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  const cfg = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
  fs.writeFileSync('claude-was-here.txt', JSON.stringify({ cwd: process.cwd(), args, input, mcp: cfg }));
  const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  say({ type: 'system', subtype: 'init', session_id: 'sess-1', mcp_server_errors: [] });
  say({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Fixed it and committed.' }] } });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Retry fix committed on the task branch.', total_cost_usd: 0.05, num_turns: 3, session_id: 'sess-1' });
  process.exit(Number(process.env.FAKE_EXIT || 0));
});
`;

function setup(exitCode = 0) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-e2e-repo-')));
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@e.com', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init']);
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-e2e-home-')));
  const claude = join(home, 'fake-claude');
  writeFileSync(claude, FAKE_CLAUDE);
  chmodSync(claude, 0o755);
  process.env.FAKE_EXIT = String(exitCode);

  const task: AgentTaskSummary = {
    id: '0a1b2c3d-1111-2222-3333-444455556666', title: 'Fix retries', status: 'queued', project_id: 'p1',
    project_name: 'Shop', priority: 0, scheduled_for: null, lease_holder: null, lease_expires_at: null, updated_at: '',
  };
  const events: { kind: string; body: string }[] = [];
  const api: RunnerDeps['api'] = {
    listLinks: async () => [{ project_id: 'p1', project_name: 'Shop', project_status: 'active', local_path: repo }],
    listTasks: async () => (['queued', 'in_progress', 'needs_review', 'failed'].includes(task.status) ? [task] : []),
    claim: async () => task.status === 'queued' && ((task.status = 'in_progress'), true),
    renew: async () => true,
    setStatus: async (_id, s, note) => {
      task.status = s;
      if (note) events.push({ kind: 'comment', body: note });
      return null;
    },
    addEvent: async (_id, kind, body) => (events.push({ kind, body }), 'e'),
    getTask: async () => ({ task: { ...task, notes: '' }, project: null, links: [], thread: [], project_context: [], subtasks: [] }) as unknown as TaskBundle,
    reclaimExpired: async () => 0,
    heartbeat: async () => null,
  };
  const runner = new Runner(macDeps(api, { claude_bin: claude, name: 'test' }, () => {}, home), {
    agentId: 'a1', mac: 'Test Mac', maxConcurrent: 1, capabilities: ['code'],
    nodePath: process.execPath, mcpScript: '/opt/bishop/mcp.js',
    renewEveryMs: 60_000, flushEveryMs: 60_000, pollEveryMs: 60_000, heartbeatEveryMs: 60_000,
  });
  return { repo, home, task, events, runner };
}

async function until(cond: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('runner end to end with real processes', () => {
  it('runs Claude in a fresh worktree with the MCP config, then sends the work to review', async () => {
    const { repo, home, task, events, runner } = setup(0);
    await runner.tick();
    await until(() => runner.running.size === 0 && task.status !== 'in_progress');

    expect(task.status).toBe('needs_review');
    const wt = join(home, 'worktrees', repo.split('/').pop()!, '0a1b2c3d');
    const seen = JSON.parse(readFileSync(join(wt, 'claude-was-here.txt'), 'utf8'));
    expect(realpathSync(seen.cwd)).toBe(realpathSync(wt));
    expect(seen.input).toContain('Task id: 0a1b2c3d-1111-2222-3333-444455556666');
    expect(seen.mcp.mcpServers.bishop).toMatchObject({ command: process.execPath, args: ['/opt/bishop/mcp.js'] });
    expect(seen.mcp.mcpServers.bishop.env.BISHOP_TASK_ID).toBe(task.id);
    expect(execFileSync('git', ['-C', wt, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()).toBe(
      'bishop/0a1b2c3d-fix-retries',
    );
    expect(existsSync(join(home, 'run', `mcp-${task.id}.json`))).toBe(false); // temp config cleaned up
    expect(events.some((e) => e.body.includes('Retry fix committed'))).toBe(true);
    expect(events.some((e) => e.kind === 'run_log' && e.body === 'Fixed it and committed.')).toBe(true);
    expect(events.some((e) => e.body.startsWith('Run ended · 3 turns'))).toBe(true);
  });

  it('marks the task failed when Claude exits with an error', async () => {
    const { task, runner } = setup(2);
    await runner.tick();
    await until(() => runner.running.size === 0 && task.status !== 'in_progress');
    expect(task.status).toBe('failed');
  });
});
