# Bishop

Bishop is a personal command center: buckets, projects and tasks on your phone and Macs, with Claude agents on each Mac picking up work and reporting back. The full spec lives in the Bishop spec doc.

- **v1, the organizer:** Home (Needs you, In flight, Today, Next), Plan, Inbox, Projects, task detail with ticket links and a thread, and quick add.
- **v2, agents:** each Mac runs a Bishop agent that picks up queued work in its linked projects, runs Claude Code on it, and reports back through the task thread.

## Layout

```
apps/mobile      iPhone + Android app (Expo SDK 58, Expo Router)
apps/mac         Bishop for Mac (Tauri) — v2; avatar art is here already
packages/core    shared types, Supabase data access, Home/Plan grouping logic
packages/agent-kit  the `bishop` command, the runner, and the Bishop MCP server
scripts/         install-bishop.sh
supabase/        database migrations and access tests
```

## Setup

### 1. Supabase

Bishop's project is `gthmglyafpszmtguwmbm` (US East) in the mikem3d **bishop** organization. Both migrations in `supabase/migrations/` are applied. The app has the project URL and publishable key built in (`packages/core/src/config.ts`); both are public by design.

One dashboard step is still manual: **Authentication → Emails → Magic Link** must include `{{ .Token }}` so sign-in emails carry the 6-digit code the app asks for, e.g. `Your Bishop sign-in code is {{ .Token }}`.

### 2. The phone app

```sh
pnpm install
pnpm mobile          # starts Expo
```

Scan the QR code with **Expo Go** (SDK 58) on your phone and sign in with your email. Your account starts with a workspace and three buckets: Work, Personal and Side projects.

### 3. Agents on your Macs

On each Mac (Node 20+ and Claude Code installed and signed in):

```sh
git clone https://github.com/mikem3d/bishop && cd bishop
./scripts/install-bishop.sh      # builds and puts `bishop` on your PATH
bishop login                     # your Bishop email + code, then name this Mac
cd ~/code/some-project && bishop link    # pick the Bishop project for this folder
bishop install                   # run the agent in the background at login
bishop status                    # links, running work, background agent
```

Sign in to the phone app once before `bishop login`; the CLI won't create accounts.

How it works:

- **Picking up work:** the agent listens for changes and claims queued tasks in its linked projects (up to 2 at a time; `max_concurrent` in `~/.bishop/agent.json`). Claims are atomic, so two Macs never take the same task.
- **Where it works:** in a git repo, each task gets its own worktree and branch (`bishop/<id>-<title>`) under `~/.bishop/worktrees`, so your own checkout is never touched. The branch is kept for review and reused if you send the task back.
- **How Claude runs:** `claude -p` with full permissions, the Bishop MCP server attached, and this Mac's own login, skills, CLAUDE.md and MCPs (Jira, GitHub…).
- **Reporting:** progress goes to the task thread. Agents finish at `needs_review` and can't mark work done. If Claude exits without saying, a clean exit goes to review and a crash goes to `failed`.
- **Leases:** a running task's lease is renewed every 30 seconds. If a Mac dies, the task returns to the queue within about 2 minutes.
- **Taking work back:** move a task to To do (or tap "Stop and take it back") and the agent stops.
- **Credentials:** the agent token is in the macOS Keychain; agents act only through token-checked database functions. Your login (for linking and live updates) is in `~/.bishop/session.json` (mode 600).

### 4. Installable builds

Builds run on Expo's servers under the mikem3d Expo account:

```sh
cd apps/mobile
npx eas-cli@latest login            # as mikem3d
npx eas-cli@latest build --profile preview --platform android   # installable APK
npx eas-cli@latest build --profile preview --platform ios       # needs an Apple Developer account
```

## Checks

```sh
pnpm test        # grouping logic, runner scheduling, worktrees, and a full run with a stand-in claude (vitest)
pnpm typecheck   # core + mobile
pnpm db:test     # runs the migrations on a throwaway local Postgres; checks access rules and agent functions
```

`db:test` needs Postgres 15+ binaries installed locally (it looks in `/usr/lib/postgresql/*/bin`; set `PGBIN` elsewhere, e.g. `PGBIN=/opt/homebrew/opt/postgresql@16/bin`).

## How tasks move

`inbox → todo → queued → in_progress → needs_review / blocked → done` (plus `failed`).

- A task with no project and no day starts in the **Inbox**; giving it either makes it a to-do.
- Agent work always stops at `needs_review`. Only you mark it done.
- Every status change is written to the task's thread by the database itself.
