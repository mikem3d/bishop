#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, hostname, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AgentApi, agentIdFromToken } from './agent-api.js';
import { capabilitiesFromServers, parseMcpList } from './claude.js';
import {
  deleteToken,
  ensureHome,
  loadAgentConfig,
  loadToken,
  paths,
  saveAgentConfig,
  saveToken,
  type AgentConfig,
} from './credentials.js';
import { macDeps } from './deps.js';
import { Runner } from './runner.js';
import { requireSession, userClient } from './user-client.js';
import { isGitRepo } from './workdir.js';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_SCRIPT = join(HERE, 'mcp.js');
const LAUNCHD_LABEL = 'com.mikem3d.bishop.runner';
const LAUNCHD_PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

const HELP = `bishop: connect this Mac's Claude to Bishop

  bishop login [--name <agent name>]   Sign in and register this Mac as an agent
  bishop link [<project>] [--path <dir>]  Link a Bishop project to a folder (default: current folder)
  bishop unlink [--path <dir>]         Remove the link for a folder
  bishop status                        Show this agent, its links and running work
  bishop run                           Run the agent in the foreground
  bishop install                       Run the agent in the background at login (launchd)
  bishop uninstall                     Stop and remove the background agent
  bishop logout                        Remove this Mac's agent token and login
`;

// ── Small helpers ───────────────────────────────────────────────────────────

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function macName(): Promise<string> {
  if (platform() === 'darwin') {
    try {
      return (await run('scutil', ['--get', 'ComputerName'])).stdout.trim();
    } catch {
      /* fall through */
    }
  }
  return hostname().replace(/\.local$/, '');
}

async function requireAgent(): Promise<{ api: AgentApi; config: AgentConfig; token: string }> {
  const token = await loadToken();
  const config = await loadAgentConfig();
  if (!token || !config) throw new Error('This Mac is not set up yet. Run `bishop login` first.');
  return { api: new AgentApi(token), config, token };
}

/** Ask Claude Code which MCP servers this Mac has, and map them to capabilities. */
async function detectCapabilities(claudeBin: string): Promise<string[]> {
  try {
    const { stdout } = await run(claudeBin, ['mcp', 'list'], { timeout: 60_000 });
    return capabilitiesFromServers(parseMcpList(stdout));
  } catch {
    return ['code'];
  }
}

// ── Commands ────────────────────────────────────────────────────────────────

async function login(args: string[]) {
  const name = flag(args, '--name');
  const db = userClient();
  await ensureHome();

  const { data: existing } = await db.auth.getSession();
  if (!existing.session) {
    const email = await ask('Email for your Bishop account: ');
    const { error } = await db.auth.signInWithOtp({ email: email.toLowerCase(), options: { shouldCreateUser: false } });
    if (error) throw new Error(`Couldn't send a code: ${error.message}. Sign in once in the phone app first.`);
    const code = await ask('6-digit code from the email: ');
    const { error: vErr } = await db.auth.verifyOtp({ email: email.toLowerCase(), token: code, type: 'email' });
    if (vErr) throw new Error(`That code didn't work: ${vErr.message}`);
  }
  const session = await requireSession(db);
  console.log(`Signed in as ${session.user.email}.`);

  const token = await loadToken();
  const config = await loadAgentConfig();
  if (token && config) {
    const me = await new AgentApi(token).whoami();
    console.log(`This Mac is already the agent "${me.name}". Nothing else to do.`);
    return;
  }

  const mac = await macName();
  const agentName = name || (await ask(`Name for this agent [${mac}]: `)) || mac;
  const { data, error } = await db.rpc('register_agent', { p_name: agentName, p_mac: mac });
  if (error) throw new Error(`Couldn't register this Mac: ${error.message}`);
  const reg = data as { agent_id: string; token: string };
  await saveToken(reg.token);
  const claudeBin = 'claude';
  await saveAgentConfig({
    agent_id: reg.agent_id,
    name: agentName,
    mac,
    claude_bin: claudeBin,
    claude_args: [],
    max_concurrent: 2,
    capabilities: [],
  });
  const caps = await detectCapabilities(claudeBin);
  await new AgentApi(reg.token).heartbeat(caps, mac);
  console.log(`Registered "${agentName}". Capabilities: ${caps.join(', ')}.`);
  console.log(`Token saved to ${platform() === 'darwin' ? 'the macOS Keychain' : paths.tokenFile}.`);
  console.log('\nNext: cd into a project folder and run `bishop link`, then `bishop install`.');
}

interface LocalLink {
  project_id: string;
  project_name: string;
  agent_id: string;
  linked_at: string;
}

async function link(args: string[]) {
  const dir = resolve(flag(args, '--path') ?? process.cwd());
  const query = args.join(' ').trim().toLowerCase();
  const { config } = await requireAgent();
  const db = userClient();
  await requireSession(db);

  const { data: projects, error } = await db
    .from('projects')
    .select('id, workspace_id, name, status, bucket:buckets(name), link:project_links(agent_id, local_path, agent:agents(name))')
    .neq('status', 'archived')
    .order('name');
  if (error) throw new Error(error.message);
  type Row = { id: string; workspace_id: string; name: string; bucket: unknown; link: unknown };
  const list = (projects ?? []) as unknown as Row[];
  const bucketName = (b: unknown) => (Array.isArray(b) ? b[0]?.name : (b as { name?: string } | null)?.name) as string | undefined;
  if (!list.length) throw new Error('No projects yet. Create one in the Bishop app first.');

  let chosen: Row | undefined;
  if (query) {
    chosen = list.find((p) => p.id === query) ?? list.find((p) => p.name.toLowerCase() === query);
    if (!chosen) {
      const partial = list.filter((p) => p.name.toLowerCase().includes(query));
      if (partial.length === 1) chosen = partial[0];
    }
    if (!chosen) throw new Error(`No single project matches "${query}".`);
  } else {
    list.forEach((p, i) => console.log(`  ${String(i + 1).padStart(2)}. ${p.name}${bucketName(p.bucket) ? `  (${bucketName(p.bucket)})` : ''}`));
    const pick = Number(await ask('Link which project? '));
    chosen = list[pick - 1];
    if (!chosen) throw new Error('No project chosen.');
  }

  const raw = chosen.link as
    | { agent_id: string; local_path: string; agent: { name: string } | null }
    | { agent_id: string; local_path: string; agent: { name: string } | null }[]
    | null;
  const current = Array.isArray(raw) ? raw[0] : raw;
  if (current && current.agent_id !== config.agent_id) {
    const yes = await ask(`"${chosen.name}" is linked to ${current.agent?.name ?? 'another agent'} (${current.local_path}). Move it to this Mac? [y/N] `);
    if (!/^y/i.test(yes)) return console.log('Left as it was.');
  }

  const { error: upErr } = await db.from('project_links').upsert(
    { project_id: chosen.id, workspace_id: chosen.workspace_id, agent_id: config.agent_id, local_path: dir, linked_at: new Date().toISOString() },
    { onConflict: 'project_id' },
  );
  if (upErr) throw new Error(upErr.message);

  const local: LocalLink = { project_id: chosen.id, project_name: chosen.name, agent_id: config.agent_id, linked_at: new Date().toISOString() };
  await mkdir(join(dir, '.bishop'), { recursive: true });
  await writeFile(join(dir, '.bishop', 'project.json'), JSON.stringify(local, null, 2) + '\n');
  if (await isGitRepo(dir)) {
    // Keep the link file out of commits without touching the project's .gitignore.
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--git-common-dir']);
    const exclude = resolve(dir, stdout.trim(), 'info', 'exclude');
    const current = existsSync(exclude) ? await readFile(exclude, 'utf8') : '';
    if (!current.split('\n').includes('.bishop/')) {
      await mkdir(dirname(exclude), { recursive: true });
      await appendFile(exclude, `${current.endsWith('\n') || !current ? '' : '\n'}.bishop/\n`);
    }
  }
  console.log(`Linked "${chosen.name}" to ${config.name} at ${dir}.`);
}

async function unlink(args: string[]) {
  const dir = resolve(flag(args, '--path') ?? process.cwd());
  const file = join(dir, '.bishop', 'project.json');
  if (!existsSync(file)) throw new Error(`${dir} is not linked to a Bishop project.`);
  const local = JSON.parse(await readFile(file, 'utf8')) as LocalLink;
  const db = userClient();
  await requireSession(db);
  const { error } = await db.from('project_links').delete().eq('project_id', local.project_id).eq('agent_id', local.agent_id);
  if (error) throw new Error(error.message);
  await rm(join(dir, '.bishop'), { recursive: true, force: true });
  console.log(`Unlinked "${local.project_name}".`);
}

async function status() {
  const { api, config } = await requireAgent();
  const me = await api.whoami();
  const [links, tasks] = await Promise.all([api.listLinks(), api.listTasks()]);
  console.log(`${me.name} on ${me.mac || config.mac}  ·  capabilities: ${me.capabilities.join(', ') || 'none reported'}`);
  console.log(`\nLinked projects (${links.length}):`);
  for (const l of links) {
    const ok = existsSync(l.local_path) ? '' : '  ⚠ folder missing on this Mac';
    console.log(`  ${l.project_name}${l.project_status !== 'active' ? ` [${l.project_status}]` : ''}  →  ${l.local_path}${ok}`);
  }
  if (!links.length) console.log('  none. Run `bishop link` in a project folder.');
  const mine = tasks.filter((t) => t.lease_holder === me.agent_id);
  const queued = tasks.filter((t) => t.status === 'queued');
  console.log(`\nRunning here: ${mine.length}  ·  queued: ${queued.length}  ·  waiting on you: ${tasks.filter((t) => ['blocked', 'needs_review', 'failed'].includes(t.status)).length}`);
  for (const t of mine) console.log(`  ▸ ${t.title}`);
  if (platform() === 'darwin') {
    const loaded = await run('launchctl', ['list', LAUNCHD_LABEL]).then(() => true).catch(() => false);
    console.log(`\nBackground agent: ${loaded ? 'running (launchd)' : existsSync(LAUNCHD_PLIST) ? 'installed but not running' : 'not installed. Run `bishop install`.'}`);
  }
}

async function runAgent() {
  const { api, config, token } = await requireAgent();
  await mkdir(paths.logs, { recursive: true });
  await mkdir(join(paths.home, 'run'), { recursive: true, mode: 0o700 });
  const log = (m: string) => console.log(`${new Date().toISOString()}  ${m}`);

  const capabilities = config.capabilities.length ? config.capabilities : await detectCapabilities(config.claude_bin);
  const runner = new Runner(
    macDeps(api, config, log),
    {
      agentId: agentIdFromToken(token) ?? config.agent_id,
      mac: config.mac,
      maxConcurrent: config.max_concurrent,
      capabilities,
      nodePath: process.execPath,
      mcpScript: MCP_SCRIPT,
      mcpEnv: process.env.BISHOP_HOME ? { BISHOP_HOME: process.env.BISHOP_HOME } : {},
      claudeExtraArgs: config.claude_args,
    },
  );

  // Live updates: any change to tasks or links prompts an immediate pass.
  // Without a login session the runner still works, checking every 30 seconds.
  const db = userClient();
  const { data } = await db.auth.getSession();
  if (data.session) {
    const channel = db.channel('bishop-runner');
    for (const table of ['tasks', 'project_links', 'projects']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => void runner.requestTick());
    }
    channel.subscribe((s) => log(`live updates: ${s.toLowerCase()}`));
  } else {
    log('not signed in for live updates; checking every 30 seconds. Run `bishop login` to fix.');
  }

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: putting running work back in the queue…`);
    await runner.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  log(`${config.name} is watching Bishop (up to ${config.max_concurrent} tasks at once; ${capabilities.join(', ')})`);
  runner.start();
}

function plist(nodePath: string, cliPath: string, path: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(nodePath)}</string>
    <string>${esc(cliPath)}</string>
    <string>run</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(path)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(join(paths.logs, 'runner.log'))}</string>
  <key>StandardErrorPath</key><string>${esc(join(paths.logs, 'runner.log'))}</string>
</dict>
</plist>
`;
}

async function install() {
  if (platform() !== 'darwin') throw new Error('`bishop install` sets up a macOS background agent; use `bishop run` elsewhere.');
  await requireAgent();
  await mkdir(paths.logs, { recursive: true });
  await mkdir(dirname(LAUNCHD_PLIST), { recursive: true });
  // launchd starts with a bare PATH; keep this shell's so `claude`, `git` and `node` resolve.
  await writeFile(LAUNCHD_PLIST, plist(process.execPath, join(HERE, 'cli.js'), process.env.PATH ?? '/usr/bin:/bin'));
  const uid = process.getuid?.() ?? 501;
  await run('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`]).catch(() => {});
  await run('launchctl', ['bootstrap', `gui/${uid}`, LAUNCHD_PLIST]);
  console.log(`Installed. The agent now runs in the background and starts at login.\nLogs: ${join(paths.logs, 'runner.log')}`);
}

async function uninstall() {
  const uid = process.getuid?.() ?? 501;
  await run('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`]).catch(() => {});
  await rm(LAUNCHD_PLIST, { force: true });
  console.log('Background agent stopped and removed.');
}

async function logout() {
  await uninstall().catch(() => {});
  await deleteToken();
  await userClient().auth.signOut().catch(() => {});
  await rm(paths.agent, { force: true });
  await rm(paths.session, { force: true });
  console.log('Signed out. The agent still appears in the app; remove it there if you no longer need it.');
}

async function main() {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  const commands: Record<string, (a: string[]) => Promise<void>> = {
    login,
    link,
    unlink,
    status: () => status(),
    run: () => runAgent(),
    install: () => install(),
    uninstall: () => uninstall(),
    logout: () => logout(),
  };
  const fn = commands[cmd];
  if (!fn) {
    console.log(HELP);
    process.exit(cmd === 'help' || cmd === '--help' || cmd === '-h' ? 0 : 1);
  }
  await fn(args);
  if (cmd !== 'run') process.exit(0);
}

main().catch((e) => {
  console.error(`bishop: ${(e as Error).message}`);
  process.exit(1);
});
