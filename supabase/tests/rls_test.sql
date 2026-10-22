-- Checks sign-up, triggers and row-level security. Any failure raises and stops.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'mike@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');

create function pg_temp.act_as(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
  execute 'set role authenticated';
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok: %', what;
end $$;

-- Mike signs in and sees his own workspace with starter buckets.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select pg_temp.check((select count(*) from workspaces) = 1, 'sign-up creates one visible workspace');
select pg_temp.check((select count(*) from buckets) = 3, 'sign-up creates three starter buckets');

-- Create a project and tasks.
insert into projects (workspace_id, bucket_id, name)
select b.workspace_id, b.id, 'Bishop' from buckets b where b.name = 'Side projects';

insert into tasks (workspace_id, title)
select id, 'Captured idea' from workspaces;
select pg_temp.check((select status from tasks where title = 'Captured idea') = 'inbox', 'unfiled task starts in inbox');

update tasks set project_id = (select id from projects where name = 'Bishop') where title = 'Captured idea';
select pg_temp.check((select status from tasks where title = 'Captured idea') = 'todo', 'filing an inbox task makes it a to-do');

update tasks set status = 'done' where title = 'Captured idea';
select pg_temp.check((select completed_at is not null from tasks where title = 'Captured idea'), 'done sets completed_at');
select pg_temp.check((select count(*) from task_events where kind = 'status') = 2, 'status changes are logged to the thread');

update tasks set status = 'todo' where title = 'Captured idea';
select pg_temp.check((select completed_at is null from tasks where title = 'Captured idea'), 'reopening clears completed_at');

insert into task_links (workspace_id, task_id, system, key, url)
select workspace_id, id, 'jira', 'PROJ-1', 'https://x.atlassian.net/browse/PROJ-1' from tasks where title = 'Captured idea';

insert into task_events (workspace_id, task_id, kind, body)
select workspace_id, id, 'comment', 'looks good' from tasks where title = 'Captured idea';
select pg_temp.check((select actor_user_id from task_events where kind = 'comment') = '11111111-1111-1111-1111-111111111111', 'comment is attributed to the signed-in user');

-- People cannot forge agent or status events.
do $$ begin
  insert into task_events (workspace_id, task_id, kind, body)
  select workspace_id, id, 'status', 'fake' from tasks limit 1;
  raise exception 'FAILED: forged status event was accepted';
exception when insufficient_privilege then raise notice 'ok: forged status event rejected';
end $$;

-- Agent tokens are unreadable.
do $$ begin
  perform * from agent_tokens;
  raise exception 'FAILED: agent_tokens readable';
exception when insufficient_privilege then raise notice 'ok: agent tokens are unreadable';
end $$;

-- The other user sees none of Mike's data and cannot write into his workspace.
reset role;
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select pg_temp.check((select count(*) from workspaces) = 1, 'second user sees only their own workspace');
select pg_temp.check((select count(*) from tasks) = 0, 'second user cannot see Mike''s tasks');
select pg_temp.check((select count(*) from projects) = 0, 'second user cannot see Mike''s projects');
select pg_temp.check((select count(*) from task_events) = 0, 'second user cannot see Mike''s thread');
select pg_temp.check((select count(*) from task_links) = 0, 'second user cannot see Mike''s links');

do $$ begin
  insert into tasks (workspace_id, title)
  select workspace_id, 'sneaky' from memberships m
  where m.workspace_id <> (select id from workspaces limit 1) limit 1;
  -- memberships of other workspaces are invisible, so nothing to insert; try a direct id instead
  insert into tasks (workspace_id, title)
  values ((select w.id from public.workspaces w limit 1), 'mine'); -- own workspace: allowed
end $$;

reset role;
do $$
declare mike_ws uuid;
begin
  select workspace_id into mike_ws from memberships where user_id = '11111111-1111-1111-1111-111111111111';
  perform set_config('test.mike_ws', mike_ws::text, false);
end $$;

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
do $$ begin
  insert into tasks (workspace_id, title) values (current_setting('test.mike_ws')::uuid, 'sneaky');
  raise exception 'FAILED: wrote into someone else''s workspace';
exception when insufficient_privilege then raise notice 'ok: cannot write into another workspace';
end $$;

select pg_temp.check((select count(*) from tasks where title = 'mine') = 1, 'second user can write in their own workspace');

-- A task cannot point at a project in a different workspace.
do $$ begin
  update tasks set project_id = (select null::uuid) where title = 'mine';
end $$;
reset role;
do $$ begin
  update tasks set project_id = (select id from projects limit 1)
  where title = 'mine';
  raise exception 'FAILED: cross-workspace project accepted';
exception when foreign_key_violation then raise notice 'ok: cross-workspace project rejected';
end $$;

select 'ALL CHECKS PASSED' as result;
