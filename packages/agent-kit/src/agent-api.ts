import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@bishop/core';

// Typed wrapper over the token-checked agent_* database functions.
// Agents call these without a person's login: the token is the credential.

export type AgentStatus = 'in_progress' | 'needs_review' | 'blocked' | 'failed' | 'queued';
export type AgentEventKind = 'comment' | 'question' | 'ticket_action' | 'run_log';

export interface WhoAmI {
  agent_id: string;
  name: string;
  mac: string;
  workspace_id: string;
  max_concurrent: number;
  capabilities: string[];
}

export interface LinkedProject {
  project_id: string;
  project_name: string;
  project_status: 'active' | 'paused' | 'archived';
  local_path: string;
}

export interface AgentTaskSummary {
  id: string;
  title: string;
  status: string;
  project_id: string | null;
  project_name: string | null;
  priority: number;
  scheduled_for: string | null;
  lease_holder: string | null;
  lease_expires_at: string | null;
  updated_at: string;
}

export interface TaskBundle {
  task: Record<string, unknown> & { id: string; title: string; notes: string; status: string; project_id: string | null };
  project: { id: string; name: string; status: string; local_path: string | null } | null;
  links: { id: string; system: string; key: string; url: string; snapshot: Record<string, unknown> }[];
  thread: { kind: string; body: string; created_at: string; by: 'agent' | 'you' }[];
  project_context: { source: string; body: string; source_url: string | null; created_at: string }[];
  subtasks: { id: string; title: string; status: string }[];
}

export function anonClient(url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class AgentApi {
  constructor(
    readonly token: string,
    private readonly db: SupabaseClient = anonClient(),
  ) {}

  private async call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.db.rpc(fn, { p_token: this.token, ...args });
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  }

  whoami = () => this.call<WhoAmI>('agent_whoami');
  heartbeat = (capabilities?: string[], mac?: string) =>
    this.call<null>('agent_heartbeat', { p_capabilities: capabilities ?? null, p_mac: mac ?? null });
  listLinks = () => this.call<LinkedProject[]>('agent_list_links');
  listTasks = () => this.call<AgentTaskSummary[]>('agent_list_tasks');
  claim = (taskId: string, leaseSeconds = 120) =>
    this.call<boolean>('agent_claim_task', { p_task: taskId, p_lease_seconds: leaseSeconds });
  renew = (taskId: string, leaseSeconds = 120) =>
    this.call<boolean>('agent_renew_lease', { p_task: taskId, p_lease_seconds: leaseSeconds });
  setStatus = (taskId: string, status: AgentStatus, note?: string) =>
    this.call<null>('agent_set_status', { p_task: taskId, p_status: status, p_note: note ?? null });
  addEvent = (taskId: string, kind: AgentEventKind, body: string, data: Record<string, unknown> = {}) =>
    this.call<string>('agent_add_event', { p_task: taskId, p_kind: kind, p_body: body, p_data: data });
  askHuman = (taskId: string, question: string) =>
    this.call<null>('agent_ask_human', { p_task: taskId, p_question: question });
  getTask = (taskId: string) => this.call<TaskBundle>('agent_get_task', { p_task: taskId });
  createTask = (input: {
    projectId: string;
    title: string;
    notes?: string;
    parentTaskId?: string | null;
    forAgent?: boolean;
    scheduledFor?: string | null;
  }) =>
    this.call<string>('agent_create_task', {
      p_project: input.projectId,
      p_title: input.title,
      p_notes: input.notes ?? '',
      p_parent: input.parentTaskId ?? null,
      p_for_agent: input.forAgent ?? false,
      p_scheduled_for: input.scheduledFor ?? null,
    });
  updateLinkSnapshot = (linkId: string, snapshot: Record<string, unknown>) =>
    this.call<null>('agent_update_link_snapshot', { p_link: linkId, p_snapshot: snapshot });
  addProjectContext = (projectId: string, body: string, sourceUrl?: string | null) =>
    this.call<string>('agent_add_project_context', { p_project: projectId, p_body: body, p_source_url: sourceUrl ?? null });
  reclaimExpired = () => this.call<number>('agent_reclaim_expired');
}

/** The agent's id is embedded in its token: bsh_<uuid>_<secret>. */
export function agentIdFromToken(token: string): string | null {
  const m = token.match(/^bsh_([0-9a-f-]{36})_[0-9a-f]+$/i);
  return m ? m[1]!.toLowerCase() : null;
}
