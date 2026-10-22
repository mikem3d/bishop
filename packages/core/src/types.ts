// Shapes of Bishop's rows. Keep in sync with supabase/migrations.

export type Uuid = string;
/** A calendar day in the viewer's local time, `YYYY-MM-DD`. */
export type DateOnly = string;

export const TASK_STATUSES = [
  'inbox',
  'todo',
  'queued',
  'in_progress',
  'needs_review',
  'blocked',
  'done',
  'failed',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type Priority = 0 | 1 | 2 | 3; // 0 none, 1 low, 2 medium, 3 high

export interface Workspace {
  id: Uuid;
  name: string;
  created_at: string;
}

export interface Bucket {
  id: Uuid;
  workspace_id: Uuid;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export type ProjectStatus = 'active' | 'paused' | 'archived';

export interface Project {
  id: Uuid;
  workspace_id: Uuid;
  bucket_id: Uuid;
  name: string;
  status: ProjectStatus;
  sort_order: number;
  created_at: string;
}

export interface Task {
  id: Uuid;
  workspace_id: Uuid;
  project_id: Uuid | null;
  parent_task_id: Uuid | null;
  title: string;
  notes: string;
  status: TaskStatus;
  /** Set when an agent owns the work; null means it's yours. */
  assignee_agent_id: Uuid | null;
  scheduled_for: DateOnly | null;
  due_at: string | null;
  priority: Priority;
  sort_order: number;
  completed_at: string | null;
  created_by: Uuid | null;
  created_at: string;
  updated_at: string;
}

export interface TaskLinkSnapshot {
  title?: string;
  status?: string;
  assignee?: string;
  refreshed_at?: string;
}

export interface TaskLink {
  id: Uuid;
  workspace_id: Uuid;
  task_id: Uuid;
  system: string;
  key: string;
  url: string;
  snapshot: TaskLinkSnapshot;
  created_at: string;
}

export type TaskEventKind =
  | 'comment'
  | 'status'
  | 'question'
  | 'answer'
  | 'ticket_action'
  | 'run_log';

export interface TaskEvent {
  id: Uuid;
  workspace_id: Uuid;
  task_id: Uuid;
  actor_user_id: Uuid | null;
  actor_agent_id: Uuid | null;
  kind: TaskEventKind;
  body: string;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Agent {
  id: Uuid;
  workspace_id: Uuid;
  name: string;
  mac: string;
  capabilities: string[];
  max_concurrent: number;
  last_heartbeat_at: string | null;
  created_at: string;
}

/** A task joined with the names the UI shows beside it. */
export interface TaskWithContext extends Task {
  project?: Pick<Project, 'id' | 'name' | 'bucket_id'> | null;
  bucket?: Pick<Bucket, 'id' | 'name' | 'color'> | null;
  agent?: Pick<Agent, 'id' | 'name' | 'mac'> | null;
}
