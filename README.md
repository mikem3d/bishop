# Bishop

Bishop is a personal command center: buckets, projects and tasks on your phone and Macs, with Claude agents on each Mac picking up work and reporting back. The full spec lives in the Bishop spec doc.

**v1 (this commit): the organizer.** Home (Needs you, In flight, Today, Next), Plan, Inbox, Projects, task detail with ticket links and a thread, and quick add. Agents arrive in v2.

## Layout

```
apps/mobile      iPhone + Android app (Expo SDK 58, Expo Router)
apps/mac         Bishop for Mac (Tauri) — v2; avatar art is here already
packages/core    shared types, Supabase data access, Home/Plan grouping logic
supabase/        database migrations and access tests
```

## Setup

### 1. Supabase (mikem3d account)

1. Create a project at supabase.com while signed in as **mikem3d**.
2. Open **SQL Editor**, paste `supabase/migrations/20261022120000_init.sql`, and run it.
   (Or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
3. **Authentication → Email Templates → Magic Link**: make sure the template includes `{{ .Token }}` so the email carries the 6-digit code the app asks for. For example: `Your Bishop code is {{ .Token }}`.
4. **Project Settings → API**: copy the project URL and the publishable (anon) key.

### 2. The phone app

```sh
pnpm install
cp apps/mobile/.env.example apps/mobile/.env   # paste the URL and publishable key
pnpm mobile                                     # starts Expo
```

Scan the QR code with **Expo Go** (SDK 58) on your phone. Sign in with your email; your account starts with a workspace and three buckets: Work, Personal and Side projects.

Never put the database password or a secret/service key in the app. Row-level security is what protects the data.

### 3. Installable builds

Builds run on Expo's servers under the mikem3d Expo account:

```sh
cd apps/mobile
npx eas-cli@latest login            # as mikem3d
npx eas-cli@latest build --profile preview --platform android   # installable APK
npx eas-cli@latest build --profile preview --platform ios       # needs an Apple Developer account
```

## Checks

```sh
pnpm test        # Home/Plan/Inbox grouping and link parsing (vitest)
pnpm typecheck   # core + mobile
pnpm db:test     # runs the migration on a throwaway local Postgres and checks access rules
```

`db:test` needs Postgres 15+ binaries installed locally (it looks in `/usr/lib/postgresql/*/bin`; set `PGBIN` elsewhere, e.g. `PGBIN=/opt/homebrew/opt/postgresql@16/bin`).

## How tasks move

`inbox → todo → queued → in_progress → needs_review / blocked → done` (plus `failed`).

- A task with no project and no day starts in the **Inbox**; giving it either makes it a to-do.
- Agent work always stops at `needs_review`. Only you mark it done.
- Every status change is written to the task's thread by the database itself.
