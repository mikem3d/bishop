#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AgentApi } from './agent-api.js';
import { loadToken } from './credentials.js';

// The Bishop MCP server: the tools Claude uses to read and update Bishop
// while it works a task. The runner starts it with BISHOP_TASK_ID set to
// the task being worked, so most tools default to that task.

const CURRENT = process.env.BISHOP_TASK_ID || undefined;

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }],
});
function taskId(given?: string): string {
  const id = given ?? CURRENT;
  if (!id) throw new Error('No task id given, and this session is not working a specific task.');
  return id;
}

export function buildServer(api: AgentApi): McpServer {
  const server = new McpServer({ name: 'bishop', version: '0.2.0' });
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<unknown>,
  ) =>
    server.registerTool(name, { description, inputSchema }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        return text(await run(args));
      } catch (e) {
        return fail(e);
      }
    }) as never);

  const optionalTask = { task_id: z.string().uuid().optional().describe('Task id. Defaults to the task you are working.') };

  tool(
    'get_task',
    'Read a task: title, notes, status, ticket links (with cached status), the full thread including your answers to questions, sub-tasks, and the project context log. Call this first.',
    optionalTask,
    ({ task_id }) => api.getTask(taskId(task_id)),
  );

  tool(
    'list_my_tasks',
    'List open agent work in projects linked to you: queued, in progress, blocked, waiting for review, or failed.',
    {},
    () => api.listTasks(),
  );

  tool(
    'update_status',
    "Move the task along. Use needs_review when the work is finished (the person reviews and marks it done; you cannot set done). Use failed only if you cannot continue at all. To ask a question use ask_human instead of blocked.",
    {
      ...optionalTask,
      status: z.enum(['in_progress', 'needs_review', 'failed']),
      note: z.string().optional().describe('A short summary posted to the thread with the change. For needs_review, say what you did and what to check.'),
    },
    async ({ task_id, status, note }) => {
      await api.setStatus(taskId(task_id), status, note);
      return `Task is now ${status}.`;
    },
  );

  tool(
    'comment',
    'Post progress or findings to the task thread. Keep it brief; the person reads these on a phone.',
    { ...optionalTask, body: z.string().min(1) },
    async ({ task_id, body }) => {
      await api.addEvent(taskId(task_id), 'comment', body);
      return 'Posted.';
    },
  );

  tool(
    'ask_human',
    "Ask the person a question you can't resolve yourself. This posts the question, sets the task to blocked, and notifies their phone. Stop working after calling it: the task is re-queued with their answer in the thread.",
    { ...optionalTask, question: z.string().min(1) },
    async ({ task_id, question }) => {
      await api.askHuman(taskId(task_id), question);
      return 'Question sent. The task is blocked until they answer; stop here.';
    },
  );

  tool(
    'log_ticket_action',
    'Record, in the task thread, an action you took on an external ticket (Jira, GitHub, Linear…), e.g. "Moved PROJ-1423 to In Review and commented with test results." Do this every time you change a ticket.',
    { ...optionalTask, summary: z.string().min(1), ticket_key: z.string().optional() },
    async ({ task_id, summary, ticket_key }) => {
      await api.addEvent(taskId(task_id), 'ticket_action', summary, ticket_key ? { ticket_key } : {});
      return 'Logged.';
    },
  );

  tool(
    'update_link_snapshot',
    "After reading or changing a linked ticket, refresh Bishop's cached copy so the person sees its current title, status and assignee.",
    {
      link_id: z.string().uuid().describe('The id of the link, from get_task.'),
      title: z.string().optional(),
      status: z.string().optional(),
      assignee: z.string().optional(),
    },
    async ({ link_id, title, status, assignee }) => {
      const snapshot = Object.fromEntries(
        Object.entries({ title, status, assignee }).filter(([, v]) => v !== undefined),
      );
      await api.updateLinkSnapshot(link_id, snapshot);
      return 'Snapshot updated.';
    },
  );

  tool(
    'create_task',
    'Create follow-up work in a linked project. With for_agent=false (default) it becomes a to-do for the person (for example "Approve PR #12"). With for_agent=true it is queued for you to do later, optionally as a sub-task of the current task.',
    {
      project_id: z.string().uuid().describe('A project linked to you; get_task shows the current project id.'),
      title: z.string().min(1),
      notes: z.string().optional(),
      for_agent: z.boolean().optional(),
      as_subtask: z.boolean().optional().describe('Make it a sub-task of the task you are working.'),
      scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
    },
    async ({ project_id, title, notes, for_agent, as_subtask, scheduled_for }) => {
      const id = await api.createTask({
        projectId: project_id,
        title,
        notes,
        forAgent: for_agent,
        parentTaskId: as_subtask ? taskId() : null,
        scheduledFor: scheduled_for ?? null,
      });
      return { id, status: for_agent ? 'queued for you' : 'to-do for the person' };
    },
  );

  tool(
    'get_project_context',
    "Read the project's context log: decisions, status and facts gathered from tickets, chat and earlier work. get_task already includes it for the current task.",
    { ...optionalTask },
    async ({ task_id }) => (await api.getTask(taskId(task_id))).project_context,
  );

  tool(
    'add_project_context',
    'Record a durable fact about the project for future work: a decision, a convention, where something lives. Not for progress updates (use comment).',
    {
      project_id: z.string().uuid(),
      body: z.string().min(1),
      source_url: z.string().url().optional(),
    },
    async ({ project_id, body, source_url }) => {
      await api.addProjectContext(project_id, body, source_url);
      return 'Added to the project context.';
    },
  );

  return server;
}

async function main() {
  const token = process.env.BISHOP_AGENT_TOKEN || (await loadToken());
  if (!token) {
    console.error('bishop-mcp: no agent token. Run `bishop login` on this Mac first.');
    process.exit(1);
  }
  const server = buildServer(new AgentApi(token));
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && /mcp\.(js|ts)$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
