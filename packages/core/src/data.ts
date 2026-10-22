import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Agent,
  Bucket,
  Priority,
  Project,
  Task,
  TaskEvent,
  TaskLink,
  TaskStatus,
  TaskWithContext,
  Uuid,
  Workspace,
} from './types';

// Thin, typed wrappers over the Supabase tables. Row-level security decides
// what each signed-in user can see, so nothing here filters by user.

type Client = SupabaseClient;

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

// ── Workspace ────────────────────────────────────────────────────────────────

/** The signed-in user's workspace. One per user for now; created at sign-up. */
export async function getWorkspace(db: Client): Promise<Workspace> {
  const rows = must(
    await db.from('workspaces').select('*').order('created_at').limit(1),
  ) as Workspace[];
  const ws = rows[0];
  if (!ws) throw new Error('No workspace found for this account.');
  return ws;
}

// ── Buckets and projects ─────────────────────────────────────────────────────

export async function listBuckets(db: Client): Promise<Bucket[]> {
  return must(await db.from('buckets').select('*').order('sort_order').order('created_at'));
}

export async function createBucket(
  db: Client,
  input: { workspace_id: Uuid; name: string; color?: string },
): Promise<Bucket> {
  return must(await db.from('buckets').insert(input).select().single());
}

export async function updateBucket(
  db: Client,
  id: Uuid,
  patch: Partial<Pick<Bucket, 'name' | 'color' | 'sort_order'>>,
): Promise<Bucket> {
  return must(await db.from('buckets').update(patch).eq('id', id).select().single());
}

export async function deleteBucket(db: Client, id: Uuid): Promise<void> {
  must(await db.from('buckets').delete().eq('id', id));
}

export interface ProjectWithLink extends Project {
  /** The agent this project is linked to with `bishop link`, if any. */
  linkedAgent: { id: Uuid; name: string } | null;
}

type RawProject = Project & {
  link: { agent: { id: Uuid; name: string } | null } | { agent: { id: Uuid; name: string } | null }[] | null;
};

export async function listProjects(db: Client): Promise<ProjectWithLink[]> {
  const rows = must(
    await db
      .from('projects')
      .select('*, link:project_links(agent:agents(id, name))')
      .neq('status', 'archived')
      .order('sort_order')
      .order('name'),
  ) as RawProject[];
  return rows.map(({ link, ...p }) => {
    const l = Array.isArray(link) ? link[0] : link;
    return { ...p, linkedAgent: l?.agent ?? null };
  });
}

export async function getProject(db: Client, id: Uuid): Promise<Project> {
  return must(await db.from('projects').select('*').eq('id', id).single());
}

export async function createProject(
  db: Client,
  input: { workspace_id: Uuid; bucket_id: Uuid; name: string },
): Promise<Project> {
  return must(await db.from('projects').insert(input).select().single());
}

export async function updateProject(
  db: Client,
  id: Uuid,
  patch: Partial<Pick<Project, 'name' | 'bucket_id' | 'status' | 'sort_order'>>,
): Promise<Project> {
  return must(await db.from('projects').update(patch).eq('id', id).select().single());
}

/** Remove a project's agent link. Its queued work waits until it's linked again. */
export async function unlinkProject(db: Client, projectId: Uuid): Promise<void> {
  must(await db.from('project_links').delete().eq('project_id', projectId));
}

// ── Tasks ────────────────────────────────────────────────────────────────────

const TASK_SELECT =
  '*, project:projects(id, name, bucket_id, bucket:buckets(id, name, color)), agent:agents(id, name, mac)';

type RawTask = Task & {
  project: (Pick<Project, 'id' | 'name' | 'bucket_id'> & { bucket: Pick<Bucket, 'id' | 'name' | 'color'> | null }) | null;
  agent: Pick<Agent, 'id' | 'name' | 'mac'> | null;
};

function flatten(r: RawTask): TaskWithContext {
  const { project, agent, ...task } = r;
  return {
    ...task,
    project: project ? { id: project.id, name: project.name, bucket_id: project.bucket_id } : null,
    bucket: project?.bucket ?? null,
    agent,
  };
}

/** Every open task, plus tasks finished in the last `doneDays` days. */
export async function listTasks(db: Client, opts: { doneDays?: number } = {}): Promise<TaskWithContext[]> {
  const since = new Date(Date.now() - (opts.doneDays ?? 2) * 86_400_000).toISOString();
  const rows = must(
    await db
      .from('tasks')
      .select(TASK_SELECT)
      .or(`status.neq.done,completed_at.gte.${since}`)
      .order('created_at'),
  ) as RawTask[];
  return rows.map(flatten);
}

export async function listProjectTasks(db: Client, projectId: Uuid): Promise<TaskWithContext[]> {
  const rows = must(
    await db.from('tasks').select(TASK_SELECT).eq('project_id', projectId).order('created_at'),
  ) as RawTask[];
  return rows.map(flatten);
}

export async function getTask(db: Client, id: Uuid): Promise<TaskWithContext> {
  return flatten(must(await db.from('tasks').select(TASK_SELECT).eq('id', id).single()) as RawTask);
}

export interface NewTask {
  workspace_id: Uuid;
  title: string;
  project_id?: Uuid | null;
  notes?: string;
  scheduled_for?: string | null;
  due_at?: string | null;
  priority?: Priority;
  parent_task_id?: Uuid | null;
}

/** New tasks with no project and no day land in the Inbox; anything else is a to-do. */
export function initialStatus(t: Pick<NewTask, 'project_id' | 'scheduled_for' | 'due_at'>): TaskStatus {
  return t.project_id || t.scheduled_for || t.due_at ? 'todo' : 'inbox';
}

export async function createTask(db: Client, input: NewTask): Promise<Task> {
  return must(
    await db
      .from('tasks')
      .insert({ ...input, status: initialStatus(input) })
      .select()
      .single(),
  );
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'notes' | 'project_id' | 'scheduled_for' | 'due_at' | 'priority' | 'status' | 'sort_order'>
>;

export async function updateTask(db: Client, id: Uuid, patch: TaskPatch): Promise<Task> {
  return must(await db.from('tasks').update(patch).eq('id', id).select().single());
}

export const completeTask = (db: Client, id: Uuid) => updateTask(db, id, { status: 'done' });
export const reopenTask = (db: Client, id: Uuid) => updateTask(db, id, { status: 'todo' });

export async function deleteTask(db: Client, id: Uuid): Promise<void> {
  must(await db.from('tasks').delete().eq('id', id));
}

// ── Links and thread ─────────────────────────────────────────────────────────

export async function listTaskLinks(db: Client, taskId: Uuid): Promise<TaskLink[]> {
  return must(await db.from('task_links').select('*').eq('task_id', taskId).order('created_at'));
}

/** Guess the system and key from a pasted ticket URL. */
export function parseTicketUrl(url: string): { system: string; key: string } {
  const u = url.trim();
  const jira = u.match(/atlassian\.net\/browse\/([A-Z][A-Z0-9_]+-\d+)/i) ?? u.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
  if (jira) return { system: 'jira', key: jira[1]!.toUpperCase() };
  const gh = u.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/i);
  if (gh) return { system: 'github', key: `${gh[1]}#${gh[2]}` };
  const linear = u.match(/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]+-\d+)/i);
  if (linear) return { system: 'linear', key: linear[1]!.toUpperCase() };
  let host = 'link';
  try {
    host = new URL(u).hostname.replace(/^www\./, '').split('.')[0] ?? 'link';
  } catch {
    /* not a URL */
  }
  return { system: host, key: u.split('/').filter(Boolean).pop() ?? u };
}

export async function addTaskLink(
  db: Client,
  input: { workspace_id: Uuid; task_id: Uuid; url: string; system?: string; key?: string },
): Promise<TaskLink> {
  const guess = parseTicketUrl(input.url);
  return must(
    await db
      .from('task_links')
      .insert({
        workspace_id: input.workspace_id,
        task_id: input.task_id,
        url: input.url.trim(),
        system: input.system ?? guess.system,
        key: input.key ?? guess.key,
      })
      .select()
      .single(),
  );
}

export async function deleteTaskLink(db: Client, id: Uuid): Promise<void> {
  must(await db.from('task_links').delete().eq('id', id));
}

export async function listTaskEvents(db: Client, taskId: Uuid): Promise<TaskEvent[]> {
  return must(await db.from('task_events').select('*').eq('task_id', taskId).order('created_at'));
}

export async function addComment(
  db: Client,
  input: { workspace_id: Uuid; task_id: Uuid; body: string; kind?: 'comment' | 'answer' },
): Promise<TaskEvent> {
  return must(
    await db
      .from('task_events')
      .insert({ ...input, kind: input.kind ?? 'comment' })
      .select()
      .single(),
  );
}

// ── Agents (read-only in v1) ────────────────────────────────────────────────

export async function listAgents(db: Client): Promise<Agent[]> {
  return must(await db.from('agents').select('id, workspace_id, name, mac, capabilities, max_concurrent, last_heartbeat_at, created_at').order('name'));
}

export function isAgentOnline(a: Pick<Agent, 'last_heartbeat_at'>, now = Date.now()): boolean {
  return !!a.last_heartbeat_at && now - new Date(a.last_heartbeat_at).getTime() < 60_000;
}

// ── Live updates ────────────────────────────────────────────────────────────

/** Call `onChange` whenever any Bishop table changes. Returns an unsubscribe function. */
export function subscribeToChanges(db: Client, onChange: (table: string) => void): () => void {
  const channel = db.channel('bishop-changes');
  for (const table of ['tasks', 'task_events', 'task_links', 'projects', 'buckets', 'agents', 'project_links']) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange(table));
  }
  channel.subscribe();
  return () => {
    void db.removeChannel(channel);
  };
}
