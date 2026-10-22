-- Agent functions: registration, token checks, linking, claiming, leases,
-- the review gate, and isolation between agents and workspaces.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'owner@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'stranger@example.com');

create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  if u is null then execute 'set role anon'; else execute 'set role authenticated'; end if;
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;

create function pg_temp.expect_error(sql text, what text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'FAILED: % (no error)', what;
exception when others then
  if sqlerrm like 'FAILED:%' then raise; end if;
  raise notice 'ok: % (%)', what, sqlerrm;
end $$;

-- Owner signs in, registers two agents, and sets up a project and tasks.
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
create temp table t_agents (name text, agent_id uuid, token text);
grant all on t_agents to public;
insert into t_agents
select 'studio', (r->>'agent_id')::uuid, r->>'token' from (select public.register_agent('studio', 'Mac Studio') r) x;
insert into t_agents
select 'air', (r->>'agent_id')::uuid, r->>'token' from (select public.register_agent('air', 'MacBook Air') r) x;
select pg_temp.check((select count(*) from agents) = 2, 'register_agent creates agents in my workspace');
select pg_temp.check((select bool_and(token like 'bsh_%') from t_agents), 'register_agent returns a bsh_ token');

insert into projects (workspace_id, bucket_id, name)
select workspace_id, id, 'Shop' from buckets where name = 'Work';
insert into projects (workspace_id, bucket_id, name)
select workspace_id, id, 'Other' from buckets where name = 'Work';

-- Link Shop to studio, the way `bishop link` does.
insert into project_links (project_id, workspace_id, agent_id, local_path)
select p.id, p.workspace_id, (select agent_id from t_agents where name = 'studio'), '/Users/mike/code/shop'
from projects p where p.name = 'Shop';

insert into tasks (workspace_id, project_id, title, status)
select workspace_id, id, 'Fix retries', 'queued' from projects where name = 'Shop';
insert into tasks (workspace_id, project_id, title, status)
select workspace_id, id, 'Not for agents', 'queued' from projects where name = 'Other';
insert into tasks (workspace_id, project_id, title)
select workspace_id, id, 'My own todo' from projects where name = 'Shop';

-- Agents can't read tables directly, so keep the ids in temp tables for the test.
reset role;
create temp table t_tasks as select title, id from tasks;
create temp table t_projects as select name, id from projects;
grant all on t_tasks, t_projects to public;

-- From here on, the agents act without a person's login.
select pg_temp.act_as(null);

select pg_temp.expect_error($$select public.agent_whoami('bsh_nope')$$, 'garbage token rejected');
select pg_temp.expect_error(
  format($$select public.agent_whoami('bsh_%s_wrongsecret')$$, (select agent_id from t_agents where name = 'studio')),
  'right agent, wrong secret rejected');
select pg_temp.check(
  (select public.agent_whoami(token)->>'name' from t_agents where name = 'studio') = 'studio',
  'valid token identifies the agent');

select public.agent_heartbeat(token, array['jira', 'github'], 'Mac Studio') from t_agents where name = 'studio';

select pg_temp.check(
  (select jsonb_array_length(public.agent_list_links(token)) from t_agents where name = 'studio') = 1,
  'studio sees its one linked project');
select pg_temp.check(
  (select jsonb_array_length(public.agent_list_links(token)) from t_agents where name = 'air') = 0,
  'air sees no linked projects');

select pg_temp.check(
  (select jsonb_array_length(public.agent_list_tasks(token)) from t_agents where name = 'studio') = 1,
  'studio sees only queued work in its linked project');

-- air cannot claim studio's work; studio can, exactly once.
select pg_temp.check(
  not (select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'air' and t.title = 'Fix retries'),
  'unlinked agent cannot claim');
select pg_temp.check(
  (select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'),
  'linked agent claims queued task');
select pg_temp.check(
  not (select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'),
  'second claim of the same task fails');
select pg_temp.check(
  not (select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Not for agents'),
  'cannot claim a task in an unlinked project');
select pg_temp.check(
  not (select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'My own todo'),
  'cannot claim a task that is not queued');

select pg_temp.check(
  (select public.agent_renew_lease(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'),
  'lease renews for the holder');

-- Thread, task details and follow-ups.
select public.agent_add_event(a.token, t.id, 'comment', 'Found the bug.') from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries';
select public.agent_add_event(a.token, t.id, 'ticket_action', 'Moved PROJ-1 to In Review') from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries';
select pg_temp.expect_error(
  $$select public.agent_add_event(a.token, t.id, 'answer', 'pretending to be you') from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'$$,
  'agent cannot post an answer as you');
select pg_temp.expect_error(
  $$select public.agent_add_event(a.token, t.id, 'comment', 'hi') from t_agents a, t_tasks t where a.name = 'air' and t.title = 'Fix retries'$$,
  'other agent cannot comment on the task');

select pg_temp.check(
  (select (public.agent_get_task(a.token, t.id)->'project'->>'local_path') = '/Users/mike/code/shop'
   from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'),
  'get_task returns the linked folder');
select pg_temp.check(
  (select jsonb_array_length(public.agent_get_task(a.token, t.id)->'thread') >= 3
   from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'),
  'get_task returns the thread');

select public.agent_create_task(a.token, p.id, 'Approve the PR', 'Review #12')
from t_agents a, t_projects p where a.name = 'studio' and p.name = 'Shop';
reset role;
select pg_temp.check((select status = 'todo' and assignee_agent_id is null from tasks where title = 'Approve the PR'),
  'agent can create a to-do for you');
select pg_temp.act_as(null);
select pg_temp.expect_error(
  $$select public.agent_create_task(a.token, p.id, 'sneaky') from t_agents a, t_projects p where a.name = 'studio' and p.name = 'Other'$$,
  'agent cannot create tasks in unlinked projects');

select public.agent_add_project_context(a.token, p.id, 'Retries use idempotency keys now.')
from t_agents a, t_projects p where a.name = 'studio' and p.name = 'Shop';

-- The review gate.
select pg_temp.expect_error(
  $$select public.agent_set_status(a.token, t.id, 'done') from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries'$$,
  'agent cannot mark work done');
select public.agent_set_status(a.token, t.id, 'needs_review', 'PR #12 is ready.')
from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries';

reset role;
select pg_temp.check((select status = 'needs_review' and lease_holder is null from tasks where title = 'Fix retries'),
  'needs_review releases the lease');
select pg_temp.check(
  (select actor_agent_id = (select agent_id from t_agents where name = 'studio')
   from task_events e join tasks t on t.id = e.task_id
   where t.title = 'Fix retries' and e.kind = 'status' and e.body = 'in_progress → needs_review'),
  'status change is credited to the agent');

-- You answer and re-queue; the agent can pick it up again.
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
update tasks set status = 'queued' where title = 'Fix retries';
select pg_temp.check(
  (select actor_agent_id is null and actor_user_id = '33333333-3333-3333-3333-333333333333'
   from task_events e join tasks t on t.id = e.task_id
   where t.title = 'Fix retries' and e.kind = 'status' and e.body = 'needs_review → queued'),
  'your status change is credited to you');
select pg_temp.check((select count(*) from project_context) = 1, 'you can read the context the agent added');
reset role;

-- A crashed run: lease lapses and the task goes back to the queue.
select pg_temp.act_as(null);
select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries';
reset role;
update tasks set lease_expires_at = now() - interval '1 minute' where title = 'Fix retries';
select pg_temp.act_as(null);
select pg_temp.check((select public.agent_reclaim_expired(token) from t_agents where name = 'air') = 1,
  'expired lease is reclaimed');
reset role;
select pg_temp.check((select status = 'queued' and lease_holder is null from tasks where title = 'Fix retries'),
  'reclaimed task is queued again');

-- ask_human blocks the task.
select pg_temp.act_as(null);
select public.agent_claim_task(a.token, t.id) from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries';
select public.agent_ask_human(a.token, t.id, 'Which API keys for staging?') from t_agents a, t_tasks t where a.name = 'studio' and t.title = 'Fix retries';
reset role;
select pg_temp.check((select status = 'blocked' from tasks where title = 'Fix retries'), 'ask_human blocks the task');

-- Isolation: a stranger cannot register agents into the owner's workspace or see them.
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select pg_temp.check((select count(*) from agents) = 0, 'stranger sees none of the owner''s agents');
select public.register_agent('strangers-mac');
select pg_temp.check(
  (select count(*) from agents) = 1 and
  (select workspace_id from agents) <> (select workspace_id from tasks limit 1) is not false,
  'stranger''s agent lands in the stranger''s own workspace');
reset role;
select pg_temp.check(
  (select a.workspace_id from agents a where a.name = 'strangers-mac') <>
  (select a.workspace_id from agents a where a.name = 'studio'),
  'agents are isolated by workspace');

-- People cannot call the anonymous registration path.
select pg_temp.act_as(null);
select pg_temp.expect_error($$select public.register_agent('anon-mac')$$, 'registration requires a login');
reset role;

select 'ALL AGENT CHECKS PASSED' as result;
