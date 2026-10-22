// Starting Claude Code for a task, and making sense of what it prints.

export interface PromptInput {
  taskId: string;
  title: string;
  projectName: string | null;
  workdir: string;
  branch: string | null;
  isRerun: boolean;
}

/** The instruction Claude gets for one task. Details come from the get_task tool. */
export function buildPrompt(p: PromptInput): string {
  const lines = [
    `You are a Bishop agent working one task.`,
    ``,
    `Task: ${p.title}`,
    `Task id: ${p.taskId}`,
    p.projectName ? `Project: ${p.projectName}` : null,
    `Working folder: ${p.workdir}`,
    p.branch ? `Git branch: ${p.branch} (a separate worktree just for this task; commit your work here)` : null,
    ``,
    `How to work:`,
    `1. Call the bishop get_task tool first. It has the notes, linked tickets, the thread, and the project context.`,
    p.isRerun
      ? `2. This task ran before. Read the thread: your earlier comments and the person's replies or answers come after them. Continue from there.`
      : `2. Do the work described. Follow this folder's CLAUDE.md and your own skills and rules for tickets and tools.`,
    `3. Post short progress notes with comment when something meaningful happens; the person reads them on a phone.`,
    `4. Whenever you change an external ticket, call log_ticket_action, then update_link_snapshot.`,
    `5. If you need a decision only the person can make, call ask_human and stop.`,
    `6. When finished, call update_status with status needs_review and a short note: what you did, where it is, and what to check. You cannot mark work done; the person does that.`,
    `7. Save durable facts about the project (decisions, conventions) with add_project_context.`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export const SYSTEM_APPEND =
  'You are running unattended under Bishop. Nobody is watching the terminal: communicate only through the bishop tools. Never mark tasks done.';

export function claudeArgs(mcpConfigPath: string, extra: string[] = []): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--append-system-prompt',
    SYSTEM_APPEND,
    ...extra,
    '--mcp-config',
    mcpConfigPath,
  ];
}

export function mcpConfig(nodePath: string, mcpScript: string, env: Record<string, string>) {
  return { mcpServers: { bishop: { type: 'stdio', command: nodePath, args: [mcpScript], env } } };
}

// ── Reading stream-json ─────────────────────────────────────────────────────

export interface RunSummary {
  sessionId: string | null;
  resultText: string | null;
  isError: boolean;
  subtype: string | null;
  costUsd: number | null;
  turns: number | null;
}

export type StreamNote =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'init'; sessionId: string | null; mcpErrors: unknown[] }
  | { type: 'result'; summary: RunSummary };

/** Turn one stream-json line into something worth logging, if anything. */
export function parseStreamLine(line: string): StreamNote[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return [];
  let ev: Record<string, any>;
  try {
    ev = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (ev.type === 'system' && ev.subtype === 'init') {
    const errors = Array.isArray(ev.mcp_server_errors) ? ev.mcp_server_errors : [];
    return [{ type: 'init', sessionId: ev.session_id ?? null, mcpErrors: errors }];
  }
  if (ev.type === 'assistant' && !ev.parent_tool_use_id) {
    const out: StreamNote[] = [];
    for (const block of ev.message?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        out.push({ type: 'text', text: block.text.trim() });
      } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
        out.push({ type: 'tool', name: block.name });
      }
    }
    return out;
  }
  if (ev.type === 'result') {
    return [
      {
        type: 'result',
        summary: {
          sessionId: ev.session_id ?? null,
          resultText: typeof ev.result === 'string' ? ev.result : null,
          isError: ev.is_error === true || (typeof ev.subtype === 'string' && ev.subtype.startsWith('error')),
          subtype: ev.subtype ?? null,
          costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : null,
          turns: typeof ev.num_turns === 'number' ? ev.num_turns : null,
        },
      },
    ];
  }
  return [];
}

/** "mcp__bishop__comment" → "bishop: comment"; "Edit" → "Edit". */
export function toolLabel(name: string): string {
  const m = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  return m ? `${m[1]}: ${m[2]}` : name;
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

// ── Capabilities ────────────────────────────────────────────────────────────

const CAPABILITY_HINTS: [RegExp, string][] = [
  [/jira|atlassian|rovo/i, 'jira'],
  [/github/i, 'github'],
  [/gitlab/i, 'gitlab'],
  [/linear/i, 'linear'],
  [/slack/i, 'slack'],
  [/teams|microsoft|m365|outlook/i, 'teams'],
  [/gmail|google.?mail/i, 'gmail'],
  [/calendar/i, 'calendar'],
  [/notion/i, 'notion'],
  [/servicenow/i, 'servicenow'],
  [/sentry/i, 'sentry'],
  [/figma/i, 'figma'],
];

/** Map MCP server names (from `claude mcp list`) to capabilities Bishop routes on. */
export function capabilitiesFromServers(serverNames: string[]): string[] {
  const caps = new Set<string>(['code']);
  for (const name of serverNames) {
    for (const [re, cap] of CAPABILITY_HINTS) if (re.test(name)) caps.add(cap);
  }
  return [...caps].sort();
}

/** Server names from `claude mcp list` output lines like "jira: https://… - ✓ Connected". */
export function parseMcpList(output: string): string[] {
  return output
    .split('\n')
    .map((l) => l.match(/^([A-Za-z0-9_.\-]+):\s/)?.[1])
    .filter((n): n is string => !!n && n !== 'bishop');
}
