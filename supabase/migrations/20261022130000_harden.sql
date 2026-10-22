-- Hardening from Supabase's security and performance advisors.

-- Access helpers move out of the API-exposed schema. Policies refer to
-- functions by identity, so they keep working after the move.
create schema if not exists private;
grant usage on schema private to authenticated;
alter function public.is_member(uuid) set schema private;
alter function public.can_edit(uuid) set schema private;
revoke execute on function private.is_member(uuid), private.can_edit(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.can_edit(uuid) to authenticated;

-- Trigger functions are only ever called by their triggers.
alter function public.tasks_before_write() set search_path = public;
revoke execute on function public.tasks_before_write(), public.tasks_log_status(), public.handle_new_user()
  from public, anon, authenticated;

-- Evaluate the signed-in user once per query, not once per row.
drop policy "owners rename workspace" on public.workspaces;
create policy "owners rename workspace" on public.workspaces
  for update to authenticated using (exists (
    select 1 from public.memberships m
    where m.workspace_id = workspaces.id and m.user_id = (select auth.uid()) and m.role = 'owner'));

drop policy "editors comment" on public.task_events;
create policy "editors comment" on public.task_events
  for insert to authenticated with check (
    private.can_edit(workspace_id) and kind in ('comment', 'answer')
    and actor_user_id = (select auth.uid()) and actor_agent_id is null);

-- Cover the foreign keys used by joins and cascades.
create index if not exists projects_bucket_ws_idx on public.projects (bucket_id, workspace_id);
create index if not exists project_links_project_ws_idx on public.project_links (project_id, workspace_id);
create index if not exists project_links_agent_ws_idx on public.project_links (agent_id, workspace_id);
create index if not exists project_context_project_ws_idx on public.project_context (project_id, workspace_id);
create index if not exists tasks_project_ws_idx on public.tasks (project_id, workspace_id);
create index if not exists tasks_parent_ws_idx on public.tasks (parent_task_id, workspace_id);
create index if not exists tasks_agent_ws_idx on public.tasks (assignee_agent_id, workspace_id);
create index if not exists tasks_created_by_idx on public.tasks (created_by);
create index if not exists task_links_task_ws_idx on public.task_links (task_id, workspace_id);
create index if not exists task_events_task_ws_idx on public.task_events (task_id, workspace_id);
create index if not exists task_events_actor_user_idx on public.task_events (actor_user_id);
create index if not exists task_events_actor_agent_idx on public.task_events (actor_agent_id);
-- Superseded by the composite indexes above.
drop index if exists public.projects_bucket_idx;
drop index if exists public.project_links_agent_idx;
drop index if exists public.tasks_project_idx;
drop index if exists public.task_links_task_idx;
