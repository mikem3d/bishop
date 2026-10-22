import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Everything Bishop keeps on a Mac lives in ~/.bishop (override with BISHOP_HOME):
//   agent.json      this agent's id, name and settings (no secrets)
//   session.json    your Supabase login, for linking projects and live updates (mode 600)
//   worktrees/      one working copy per running task
//   logs/           runner logs
// The agent token goes in the macOS Keychain; elsewhere it falls back to ~/.bishop/token (mode 600).

export const BISHOP_HOME = process.env.BISHOP_HOME || join(homedir(), '.bishop');
export const paths = {
  home: BISHOP_HOME,
  agent: join(BISHOP_HOME, 'agent.json'),
  session: join(BISHOP_HOME, 'session.json'),
  tokenFile: join(BISHOP_HOME, 'token'),
  worktrees: join(BISHOP_HOME, 'worktrees'),
  logs: join(BISHOP_HOME, 'logs'),
};

const KEYCHAIN_SERVICE = 'bishop-agent';
const useKeychain = () => platform() === 'darwin' && process.env.BISHOP_NO_KEYCHAIN !== '1';

export async function ensureHome(): Promise<void> {
  await mkdir(BISHOP_HOME, { recursive: true, mode: 0o700 });
  await chmod(BISHOP_HOME, 0o700).catch(() => {});
}

async function writePrivate(path: string, contents: string): Promise<void> {
  await ensureHome();
  await writeFile(path, contents, { mode: 0o600 });
  await chmod(path, 0o600);
}

// ── Agent token ─────────────────────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> {
  if (useKeychain()) {
    // -U updates an existing item in place.
    await run('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', 'agent', '-w', token]);
    return;
  }
  await writePrivate(paths.tokenFile, token + '\n');
}

export async function loadToken(): Promise<string | null> {
  if (process.env.BISHOP_AGENT_TOKEN) return process.env.BISHOP_AGENT_TOKEN;
  if (useKeychain()) {
    try {
      const { stdout } = await run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'agent', '-w']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  try {
    return (await readFile(paths.tokenFile, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

export async function deleteToken(): Promise<void> {
  if (useKeychain()) {
    await run('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', 'agent']).catch(() => {});
  }
  await rm(paths.tokenFile, { force: true });
}

// ── Agent settings ──────────────────────────────────────────────────────────

export interface AgentConfig {
  agent_id: string;
  name: string;
  mac: string;
  /** Command used to start Claude Code. */
  claude_bin: string;
  /** Extra arguments for every Claude Code run. */
  claude_args: string[];
  max_concurrent: number;
  /** Capabilities reported to Bishop, e.g. jira, github. Detected if empty. */
  capabilities: string[];
}

export async function loadAgentConfig(): Promise<AgentConfig | null> {
  try {
    return JSON.parse(await readFile(paths.agent, 'utf8')) as AgentConfig;
  } catch {
    return null;
  }
}

export async function saveAgentConfig(cfg: AgentConfig): Promise<void> {
  await writePrivate(paths.agent, JSON.stringify(cfg, null, 2) + '\n');
}

// ── Your login session (Supabase auth storage adapter) ──────────────────────

/** A file-backed storage adapter for supabase-js, so the login survives restarts. */
export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const all = JSON.parse(await readFile(paths.session, 'utf8')) as Record<string, string>;
      return all[key] ?? null;
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    let all: Record<string, string> = {};
    try {
      all = JSON.parse(await readFile(paths.session, 'utf8'));
    } catch {
      /* first write */
    }
    all[key] = value;
    await writePrivate(paths.session, JSON.stringify(all));
  },
  async removeItem(key: string): Promise<void> {
    try {
      const all = JSON.parse(await readFile(paths.session, 'utf8')) as Record<string, string>;
      delete all[key];
      await writePrivate(paths.session, JSON.stringify(all));
    } catch {
      /* nothing stored */
    }
  },
};
