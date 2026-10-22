import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentConfig } from './credentials.js';
import { paths } from './credentials.js';
import type { ChildLike, RunnerDeps } from './runner.js';
import { prepareWorkdir } from './workdir.js';

/** The runner's real side effects on a Mac: git worktrees, Claude processes, temp MCP configs. */
export function macDeps(
  api: RunnerDeps['api'],
  config: Pick<AgentConfig, 'claude_bin' | 'name'>,
  log: (m: string) => void,
  root = paths.home,
): RunnerDeps {
  return {
    api,
    prepareWorkdir: (o) => prepareWorkdir({ ...o, worktreesRoot: join(root, 'worktrees') }),
    spawnClaude: ({ cwd, args }) =>
      spawn(config.claude_bin, args, {
        cwd,
        env: { ...process.env, BISHOP_AGENT: config.name },
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as unknown as ChildLike,
    writeMcpConfig: async (taskId, cfg) => {
      await mkdir(join(root, 'run'), { recursive: true, mode: 0o700 });
      const p = join(root, 'run', `mcp-${taskId}.json`);
      await writeFile(p, JSON.stringify(cfg), { mode: 0o600 });
      return p;
    },
    removeMcpConfig: (p) => rm(p, { force: true }),
    log,
  };
}
