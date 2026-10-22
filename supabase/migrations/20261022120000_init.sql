-- Bishop v1 schema: workspaces, buckets, projects, tasks, links, thread,
-- plus the agent tables v2 builds on. Access is by workspace membership.

create extension if not exists pgcrypto;

-- ── Types ───────────────────────────────────────────────────────────────────

create type public.task_status as enum (
  'inbox', 'todo', 'queued', 'in_progress', 'needs_review', 'blocked', 'done', 'failed'
);
create type public.project_status as enum ('active', 'paused', 'archived');
create type public.member_role as enum ('owner', 'member', 'viewer');
create type public.task_event_kind as enum (
  'comment', 'status', 'question', 'answer', 'ticket_action', 'run_log'
);

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.buckets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#5CE1E6',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index buckets_ws_idx on public.buckets (workspace_id);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null,
  mac text not null default '',
  capabilities text[] not null default '{}',
  max_concurrent int not null default 2 check (max_concurrent > 0),
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index agents_ws_idx on public.agents (workspace_id);

-- Agent credentials live apart from agents so no app query can ever read them.
create table public.agent_tokens (
  agent_id uuid primary key references public.agents on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  bucket_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  status public.project_status not null default 'active',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  -- a project's bucket must be in the same workspace
  foreign key (bucket_id, workspace_id) references public.buckets (id, workspace_id) on delete cascade
);
create index projects_bucket_idx on public.projects (bucket_id);

-- One agent per project, set by `bishop link` on the Mac (v2).
create table public.project_links (
  project_id uuid primary key,
  workspace_id uuid not null,
  agent_id uuid not null,
  local_path text not null,
  linked_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade,
  foreign key (agent_id, workspace_id) references public.agents (id, workspace_id) on delete cascade
);
create index project_links_agent_idx on public.project_links (agent_id);

create table public.project_context (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  source text not null default 'you' check (source in ('you', 'agent', 'mention', 'ticket')),
  body text not null,
  source_url text,
  created_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete cascade
);
create index project_context_project_idx on public.project_context (project_id, created_at);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  project_id uuid,
  parent_task_id uuid,
  title text not null check (length(trim(title)) > 0),
  notes text not null default '',
  status public.task_status not null default 'inbox',
  assignee_agent_id uuid,
  scheduled_for date,
  due_at timestamptz,
  priority smallint not null default 0 check (priority between 0 and 3),
  sort_order int not null default 0,
  lease_holder uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (project_id, workspace_id) references public.projects (id, workspace_id) on delete set null (project_id),
  foreign key (parent_task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade,
  foreign key (assignee_agent_id, workspace_id) references public.agents (id, workspace_id) on delete set null (assignee_agent_id)
);
create index tasks_ws_status_idx on public.tasks (workspace_id, status);
create index tasks_project_idx on public.tasks (project_id);
create index tasks_scheduled_idx on public.tasks (workspace_id, scheduled_for) where status <> 'done';

create table public.task_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  system text not null,
  key text not null,
  url text not null,
  snapshot jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);
create index task_links_task_idx on public.task_links (task_id);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  actor_user_id uuid default auth.uid() references auth.users on delete set null,
  actor_agent_id uuid references public.agents on delete set null,
  kind public.task_event_kind not null,
  body text not null default '',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (task_id, workspace_id) references public.tasks (id, workspace_id) on delete cascade
);
create index task_events_task_idx on public.task_events (task_id, created_at);

-- ── Behaviour ───────────────────────────────────────────────────────────────

-- Keep updated_at fresh and completed_at in step with status.
create function public.tasks_before_write() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  -- Filing an inbox task into a project or onto a day makes it a to-do.
  if new.status = 'inbox' and (new.project_id is not null or new.scheduled_for is not null or new.due_at is not null)
     and (tg_op = 'INSERT' or old.status = 'inbox') then
    new.status := 'todo';
  end if;
  return new;
end $$;

create trigger tasks_before_write
before insert or update on public.tasks
for each row execute function public.tasks_before_write();

-- Every status change is written to the task's thread.
create function public.tasks_log_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.task_events (workspace_id, task_id, actor_user_id, kind, body, data)
    values (new.workspace_id, new.id, auth.uid(), 'status',
            old.status::text || ' → ' || new.status::text,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

create trigger tasks_log_status
after update on public.tasks
for each row when (old.status is distinct from new.status)
execute function public.tasks_log_status();

-- A new account gets a workspace and three starter buckets.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.workspaces (name) values ('Bishop') returning id into ws;
  insert into public.memberships (workspace_id, user_id, role) values (ws, new.id, 'owner');
  insert into public.buckets (workspace_id, name, color, sort_order) values
    (ws, 'Work', '#5CE1E6', 0),
    (ws, 'Personal', '#FFB648', 1),
    (ws, 'Side projects', '#96AAFF', 2);
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ── Access ──────────────────────────────────────────────────────────────────

create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m where m.workspace_id = ws and m.user_id = auth.uid()
  )
$$;

create function public.can_edit(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.memberships m
    where m.workspace_id = ws and m.user_id = auth.uid() and m.role in ('owner', 'member')
  )
$$;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.buckets enable row level security;
alter table public.agents enable row level security;
alter table public.agent_tokens enable row level security; -- no policies: server-side only
alter table public.projects enable row level security;
alter table public.project_links enable row level security;
alter table public.project_context enable row level security;
alter table public.tasks enable row level security;
alter table public.task_links enable row level security;
alter table public.task_events enable row level security;

create policy "members read workspace" on public.workspaces
  for select to authenticated using (public.is_member(id));
create policy "owners rename workspace" on public.workspaces
  for update to authenticated using (exists (
    select 1 from public.memberships m
    where m.workspace_id = workspaces.id and m.user_id = auth.uid() and m.role = 'owner'));

create policy "members see memberships" on public.memberships
  for select to authenticated using (public.is_member(workspace_id));

-- Same rule for every workspace-scoped table: members read, editors write.
do $$
declare t text;
begin
  foreach t in array array['buckets', 'projects', 'project_links', 'project_context', 'tasks', 'task_links'] loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member(workspace_id))', t);
    execute format('create policy "editors insert" on public.%I for insert to authenticated with check (public.can_edit(workspace_id))', t);
    execute format('create policy "editors update" on public.%I for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id))', t);
    execute format('create policy "editors delete" on public.%I for delete to authenticated using (public.can_edit(workspace_id))', t);
  end loop;
end $$;

-- The thread is append-only for people: they add comments and answers.
create policy "members read" on public.task_events
  for select to authenticated using (public.is_member(workspace_id));
create policy "editors comment" on public.task_events
  for insert to authenticated with check (
    public.can_edit(workspace_id) and kind in ('comment', 'answer')
    and actor_user_id = auth.uid() and actor_agent_id is null);

-- Agents are registered by `bishop login` (v2); people can see and remove them.
create policy "members read" on public.agents
  for select to authenticated using (public.is_member(workspace_id));
create policy "editors remove" on public.agents
  for delete to authenticated using (public.can_edit(workspace_id));
create policy "editors rename" on public.agents
  for update to authenticated using (public.can_edit(workspace_id)) with check (public.can_edit(workspace_id));

revoke all on public.agent_tokens from authenticated, anon;

-- ── Live updates ────────────────────────────────────────────────────────────

alter publication supabase_realtime add table
  public.tasks, public.task_events, public.task_links, public.projects, public.buckets, public.agents;
