-- v2: everything an agent does goes through these functions. Each one checks
-- the agent's token and touches only work in projects linked to that agent,
-- so agents never need a person's login or a service key.
--
-- Token format: bsh_<agent uuid>_<secret>. Only a SHA-256 of the secret is stored.

-- ── Token check ─────────────────────────────────────────────────────────────

create function private.agent_from_token(p_token text) returns public.agents
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
  v_secret text;
  v_agent public.agents;
begin
  if p_token is null or split_part(p_token, '_', 1) <> 'bsh' then
    raise exception 'invalid agent token' using errcode = '28000';
  end if;
  begin
    v_id := split_part(p_token, '_', 2)::uuid;
  exception when others then
    raise exception 'invalid agent token' using errcode = '28000';
  end;
  v_secret := split_part(p_token, '_', 3);
  select a.* into v_agent
  from public.agents a join public.agent_tokens t on t.agent_id = a.id
  where a.id = v_id and t.token_hash = encode(sha256(convert_to(v_secret, 'UTF8')), 'hex');
  if not found then
    raise exception 'invalid agent token' using errcode = '28000';
  end if;
  -- Status changes made during this call are credited to the agent.
  perform set_config('bishop.agent_id', v_agent.id::text, true);
  return v_agent;
end $$;

-- An agent may work on a task assigned to it, or any task in a project linked to it.
create function private.agent_can_access(p_agent uuid, p_task uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
    join public.agents a on a.id = p_agent and a.workspace_id = t.workspace_id
    where t.id = p_task
      and (t.assignee_agent_id = p_agent
           or exists (select 1 from public.project_links pl
                      where pl.project_id = t.project_id and pl.agent_id = p_agent))
  )
$$;

create function private.require_task(p_agent uuid, p_task uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.agent_can_access(p_agent, p_task) then
    raise exception 'task % is not linked to this agent', p_task using errcode = '42501';
  end if;
end $$;

-- Status changes are credited to the agent when an agent made them.
create or replace function public.tasks_log_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_agent uuid := nullif(current_setting('bishop.agent_id', true), '')::uuid;
begin
  if new.status is distinct from old.status then
    insert into public.task_events (workspace_id, task_id, actor_user_id, actor_agent_id, kind, body, data)
    values (new.workspace_id, new.id,
            case when v_agent is null then auth.uid() end, v_agent, 'status',
            old.status::text || ' → ' || new.status::text,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

-- ── Registration (called by a signed-in person through `bishop login`) ─────

create function public.register_agent(p_name text, p_mac text default '')
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ws uuid;
  v_agent uuid;
  v_secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  select m.workspace_id into v_ws from public.memberships m
  where m.user_id = auth.uid() and m.role in ('owner', 'member')
  order by m.created_at limit 1;
  if v_ws is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'agent name is required' using errcode = '22023';
  end if;
  insert into public.agents (workspace_id, name, mac) values (v_ws, trim(p_name), coalesce(p_mac, ''))
  returning id into v_agent;
  insert into public.agent_tokens (agent_id, token_hash)
  values (v_agent, encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'));
  return jsonb_build_object('agent_id', v_agent, 'workspace_id', v_ws,
                            'token', 'bsh_' || v_agent::text || '_' || v_secret);
end $$;

-- ── Agent functions ─────────────────────────────────────────────────────────

create function public.agent_whoami(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  return jsonb_build_object('agent_id', a.id, 'name', a.name, 'mac', a.mac,
                            'workspace_id', a.workspace_id, 'max_concurrent', a.max_concurrent,
                            'capabilities', to_jsonb(a.capabilities));
end $$;

create function public.agent_heartbeat(p_token text, p_capabilities text[] default null, p_mac text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  update public.agents
  set last_heartbeat_at = now(),
      capabilities = coalesce(p_capabilities, capabilities),
      mac = coalesce(p_mac, mac)
  where id = a.id;
end $$;

-- Projects linked to this agent, with the folder on its Mac.
create function public.agent_list_links(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('project_id', p.id, 'project_name', p.name,
                                        'project_status', p.status, 'local_path', pl.local_path)
                     order by p.name)
    from public.project_links pl join public.projects p on p.id = pl.project_id
    where pl.agent_id = a.id
  ), '[]'::jsonb);
end $$;

-- Open agent work this agent can see: queued, running, waiting on you.
create function public.agent_list_tasks(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'title', t.title, 'status', t.status, 'project_id', t.project_id,
             'project_name', p.name, 'priority', t.priority, 'scheduled_for', t.scheduled_for,
             'lease_holder', t.lease_holder, 'lease_expires_at', t.lease_expires_at,
             'updated_at', t.updated_at)
           order by t.priority desc, t.created_at)
    from public.tasks t left join public.projects p on p.id = t.project_id
    where t.workspace_id = a.workspace_id
      and t.status in ('queued', 'in_progress', 'blocked', 'needs_review', 'failed')
      and private.agent_can_access(a.id, t.id)
  ), '[]'::jsonb);
end $$;

-- Atomically take a queued task. False means someone else got it first.
create function public.agent_claim_task(p_token text, p_task uuid, p_lease_seconds int default 120)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  update public.tasks t
  set status = 'in_progress',
      assignee_agent_id = a.id,
      lease_holder = a.id,
      lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30))
  where t.id = p_task
    and t.status = 'queued'
    and (t.lease_expires_at is null or t.lease_expires_at < now())
    and private.agent_can_access(a.id, t.id)
    and (t.assignee_agent_id is null or t.assignee_agent_id = a.id);
  return found;
end $$;

create function public.agent_renew_lease(p_token text, p_task uuid, p_lease_seconds int default 120)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  update public.tasks
  set lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 30))
  where id = p_task and lease_holder = a.id and status = 'in_progress';
  update public.agents set last_heartbeat_at = now() where id = a.id;
  return found;
end $$;

-- Agents can move work along but never mark it done: that's yours.
create function public.agent_set_status(p_token text, p_task uuid, p_status public.task_status, p_note text default null)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  perform private.require_task(a.id, p_task);
  if p_status not in ('in_progress', 'needs_review', 'blocked', 'failed', 'queued') then
    raise exception 'agents cannot set status %; only you can', p_status using errcode = '42501';
  end if;
  if p_note is not null and trim(p_note) <> '' then
    insert into public.task_events (workspace_id, task_id, actor_user_id, actor_agent_id, kind, body)
    select t.workspace_id, t.id, null, a.id, 'comment', p_note from public.tasks t where t.id = p_task;
  end if;
  update public.tasks
  set status = p_status,
      assignee_agent_id = coalesce(assignee_agent_id, a.id),
      lease_holder = case when p_status = 'in_progress' then a.id end,
      lease_expires_at = case when p_status = 'in_progress' then now() + interval '2 minutes' end
  where id = p_task;
end $$;

create function public.agent_add_event(p_token text, p_task uuid, p_kind public.task_event_kind,
                                       p_body text, p_data jsonb default '{}')
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.agents := private.agent_from_token(p_token);
  v_id uuid;
begin
  perform private.require_task(a.id, p_task);
  if p_kind not in ('comment', 'question', 'ticket_action', 'run_log') then
    raise exception 'agents cannot post % events', p_kind using errcode = '42501';
  end if;
  insert into public.task_events (workspace_id, task_id, actor_user_id, actor_agent_id, kind, body, data)
  select t.workspace_id, t.id, null, a.id, p_kind, coalesce(p_body, ''), coalesce(p_data, '{}')
  from public.tasks t where t.id = p_task
  returning id into v_id;
  return v_id;
end $$;

-- Ask a question, stop, and wait for your answer.
create function public.agent_ask_human(p_token text, p_task uuid, p_question text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.agent_add_event(p_token, p_task, 'question', p_question);
  perform public.agent_set_status(p_token, p_task, 'blocked');
end $$;

-- Everything an agent needs to work a task: the task, its project, links,
-- thread and the project's context log.
create function public.agent_get_task(p_token text, p_task uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare a public.agents := private.agent_from_token(p_token);
begin
  perform private.require_task(a.id, p_task);
  return (
    select jsonb_build_object(
      'task', to_jsonb(t) - 'lease_holder' - 'created_by',
      'project', case when p.id is null then null else jsonb_build_object(
        'id', p.id, 'name', p.name, 'status', p.status, 'local_path', pl.local_path) end,
      'links', coalesce((select jsonb_agg(to_jsonb(l) - 'workspace_id' order by l.created_at)
                         from public.task_links l where l.task_id = t.id), '[]'::jsonb),
      'thread', coalesce((select jsonb_agg(jsonb_build_object(
                            'kind', e.kind, 'body', e.body, 'created_at', e.created_at,
                            'by', case when e.actor_agent_id is not null then 'agent' else 'you' end)
                            order by e.created_at)
                          from (select * from public.task_events e2 where e2.task_id = t.id
                                  and e2.kind <> 'run_log'
                                order by e2.created_at desc limit 100) e), '[]'::jsonb),
      'project_context', coalesce((select jsonb_agg(jsonb_build_object(
                            'source', c.source, 'body', c.body, 'source_url', c.source_url,
                            'created_at', c.created_at) order by c.created_at)
                          from (select * from public.project_context c2 where c2.project_id = t.project_id
                                order by c2.created_at desc limit 50) c), '[]'::jsonb),
      'subtasks', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'status', s.status))
                            from public.tasks s where s.parent_task_id = t.id), '[]'::jsonb))
    from public.tasks t
    left join public.projects p on p.id = t.project_id
    left join public.project_links pl on pl.project_id = p.id
    where t.id = p_task
  );
end $$;

-- Create follow-up work: a sub-task for the agent itself, or a to-do for you.
create function public.agent_create_task(p_token text, p_project uuid, p_title text,
                                         p_notes text default '', p_parent uuid default null,
                                         p_for_agent boolean default false, p_scheduled_for date default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.agents := private.agent_from_token(p_token);
  v_id uuid;
begin
  if not exists (select 1 from public.project_links where project_id = p_project and agent_id = a.id) then
    raise exception 'project % is not linked to this agent', p_project using errcode = '42501';
  end if;
  if p_parent is not null then
    perform private.require_task(a.id, p_parent);
  end if;
  insert into public.tasks (workspace_id, project_id, parent_task_id, title, notes, status,
                            assignee_agent_id, scheduled_for, created_by)
  values (a.workspace_id, p_project, p_parent, p_title, coalesce(p_notes, ''),
          (case when p_for_agent then 'queued' else 'todo' end)::public.task_status,
          case when p_for_agent then a.id end, p_scheduled_for, null)
  returning id into v_id;
  return v_id;
end $$;

create function public.agent_update_link_snapshot(p_token text, p_link uuid, p_snapshot jsonb) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.agents := private.agent_from_token(p_token);
  v_task uuid;
begin
  select task_id into v_task from public.task_links where id = p_link;
  if v_task is null then raise exception 'link % not found', p_link using errcode = 'P0002'; end if;
  perform private.require_task(a.id, v_task);
  update public.task_links
  set snapshot = coalesce(p_snapshot, '{}') || jsonb_build_object('refreshed_at', now())
  where id = p_link;
end $$;

create function public.agent_add_project_context(p_token text, p_project uuid, p_body text,
                                                 p_source_url text default null)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.agents := private.agent_from_token(p_token);
  v_id uuid;
begin
  if not exists (select 1 from public.project_links where project_id = p_project and agent_id = a.id) then
    raise exception 'project % is not linked to this agent', p_project using errcode = '42501';
  end if;
  insert into public.project_context (workspace_id, project_id, source, body, source_url)
  values (a.workspace_id, p_project, 'agent', p_body, p_source_url)
  returning id into v_id;
  return v_id;
end $$;

-- Put back work whose agent stopped renewing its lease (crashed or offline).
create function public.agent_reclaim_expired(p_token text) returns int
language plpgsql volatile security definer set search_path = public as $$
declare
  a public.agents := private.agent_from_token(p_token);
  v_count int;
begin
  with stale as (
    update public.tasks
    set status = 'queued', lease_holder = null, lease_expires_at = null
    where workspace_id = a.workspace_id and status = 'in_progress'
      and lease_expires_at is not null and lease_expires_at < now()
    returning id, workspace_id
  ), logged as (
    insert into public.task_events (workspace_id, task_id, actor_user_id, actor_agent_id, kind, body)
    select workspace_id, id, null, null, 'run_log', 'The agent stopped responding, so the task went back to the queue.'
    from stale
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end $$;

-- ── Access ──────────────────────────────────────────────────────────────────

revoke execute on function private.agent_from_token(text), private.agent_can_access(uuid, uuid),
  private.require_task(uuid, uuid) from public, anon, authenticated;

revoke execute on function public.register_agent(text, text) from public, anon;
grant execute on function public.register_agent(text, text) to authenticated;

-- Agent functions are reachable without a person's login; the token is the credential.
do $$
declare f text;
begin
  foreach f in array array[
    'agent_whoami(text)', 'agent_heartbeat(text, text[], text)', 'agent_list_links(text)',
    'agent_list_tasks(text)', 'agent_claim_task(text, uuid, int)', 'agent_renew_lease(text, uuid, int)',
    'agent_set_status(text, uuid, public.task_status, text)',
    'agent_add_event(text, uuid, public.task_event_kind, text, jsonb)', 'agent_ask_human(text, uuid, text)',
    'agent_get_task(text, uuid)', 'agent_create_task(text, uuid, text, text, uuid, boolean, date)',
    'agent_update_link_snapshot(text, uuid, jsonb)', 'agent_add_project_context(text, uuid, text, text)',
    'agent_reclaim_expired(text)'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- Live updates for links and context, so every screen and runner stays current.
alter publication supabase_realtime add table public.project_links, public.project_context;
