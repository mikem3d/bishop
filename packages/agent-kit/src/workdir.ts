import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Workdir {
  path: string;
  branch: string | null;
  /** True when a new worktree was made for this run. */
  created: boolean;
}

export function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'task'
  );
}

export function branchName(taskId: string, title: string): string {
  return `bishop/${taskId.slice(0, 8)}-${slug(title)}`;
}

async function git(cwd: string, args: string[]) {
  return run('git', ['-C', cwd, ...args], { maxBuffer: 10 * 1024 * 1024 });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const { stdout } = await git(dir, ['rev-parse', '--is-inside-work-tree']);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Where a task runs. In a git repo, each task gets its own worktree and branch
 * (reused when the task comes back after review), so parallel tasks never touch
 * the same files. Outside git, the task runs in the linked folder itself.
 */
export async function prepareWorkdir(opts: {
  linkedPath: string;
  worktreesRoot: string;
  taskId: string;
  title: string;
}): Promise<Workdir> {
  const { linkedPath, worktreesRoot, taskId, title } = opts;
  if (!existsSync(linkedPath)) throw new Error(`The linked folder ${linkedPath} does not exist on this Mac.`);
  if (!(await isGitRepo(linkedPath))) return { path: linkedPath, branch: null, created: false };

  const { stdout: top } = await git(linkedPath, ['rev-parse', '--show-toplevel']);
  const repo = top.trim();
  const branch = branchName(taskId, title);
  const repoName = repo.split('/').filter(Boolean).pop() ?? 'repo';
  const root = join(worktreesRoot, repoName, taskId.slice(0, 8));
  // A project linked to a subfolder of a repo runs in the same subfolder of its worktree.
  const sub = relative(await realpath(repo), await realpath(linkedPath));
  const path = sub ? join(root, sub) : root;

  if (existsSync(join(root, '.git'))) return { path, branch, created: false };

  await mkdir(join(worktreesRoot, repoName), { recursive: true });
  const exists = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    .then(() => true)
    .catch(() => false);
  if (exists) await git(repo, ['worktree', 'add', root, branch]);
  else await git(repo, ['worktree', 'add', '-b', branch, root, 'HEAD']);
  return { path, branch, created: true };
}
