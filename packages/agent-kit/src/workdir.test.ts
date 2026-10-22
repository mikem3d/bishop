import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareWorkdir } from './workdir.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-repo-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 'T');
  mkdirSync(join(dir, 'app'));
  writeFileSync(join(dir, 'app', 'index.ts'), 'export {}\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const TASK = '0a1b2c3d-1111-2222-3333-444455556666';

describe('prepareWorkdir', () => {
  it('gives each task its own worktree and branch, and reuses them on re-runs', async () => {
    const r = repo();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-wt-')));
    const first = await prepareWorkdir({ linkedPath: r, worktreesRoot: root, taskId: TASK, title: 'Fix retries' });
    expect(first.created).toBe(true);
    expect(first.branch).toBe('bishop/0a1b2c3d-fix-retries');
    expect(git(first.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('bishop/0a1b2c3d-fix-retries');
    expect(git(r, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main'); // your checkout is untouched

    writeFileSync(join(first.path, 'change.txt'), 'x');
    git(first.path, 'add', '.');
    git(first.path, 'commit', '-q', '-m', 'agent work');

    const again = await prepareWorkdir({ linkedPath: r, worktreesRoot: root, taskId: TASK, title: 'Fix retries' });
    expect(again.created).toBe(false);
    expect(again.path).toBe(first.path);
    expect(existsSync(join(again.path, 'change.txt'))).toBe(true);
  });

  it('recreates the worktree from the existing branch if the folder was removed', async () => {
    const r = repo();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-wt-')));
    const first = await prepareWorkdir({ linkedPath: r, worktreesRoot: root, taskId: TASK, title: 'Fix retries' });
    writeFileSync(join(first.path, 'kept.txt'), 'x');
    git(first.path, 'add', '.');
    git(first.path, 'commit', '-q', '-m', 'agent work');
    git(r, 'worktree', 'remove', '--force', first.path);
    const back = await prepareWorkdir({ linkedPath: r, worktreesRoot: root, taskId: TASK, title: 'Fix retries' });
    expect(back.created).toBe(true);
    expect(existsSync(join(back.path, 'kept.txt'))).toBe(true);
  });

  it('keeps a subfolder link pointing at the same subfolder', async () => {
    const r = repo();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-wt-')));
    const wd = await prepareWorkdir({ linkedPath: join(r, 'app'), worktreesRoot: root, taskId: TASK, title: 'x' });
    expect(wd.path.endsWith('/app')).toBe(true);
    expect(existsSync(join(wd.path, 'index.ts'))).toBe(true);
  });

  it('runs in the folder itself outside git, and fails clearly if it is missing', async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'bishop-plain-')));
    const wd = await prepareWorkdir({ linkedPath: plain, worktreesRoot: '/unused', taskId: TASK, title: 'x' });
    expect(wd).toEqual({ path: plain, branch: null, created: false });
    await expect(prepareWorkdir({ linkedPath: '/nope/missing', worktreesRoot: '/unused', taskId: TASK, title: 'x' })).rejects.toThrow(
      'does not exist on this Mac',
    );
  });
});
