# Phase 00 report — Scaffold + schema + auth

**Date:** 2026-08-16
**Status:** Complete, with two manual dashboard steps outstanding (see Open issues).

---

## Done

**Scaffold**
- Next.js 15.5.23 + React 19.1 + TypeScript strict + Tailwind CSS 4, App Router,
  `src/` dir, `@/*` import alias, ESLint. No UI component library (per Non-goals).
- Deps added: `@supabase/supabase-js`, `@supabase/ssr`, `tsx` (dev).
- `.gitignore` covers `node_modules`, `.next`, `.env*` with a `!.env.example` negation.
- `.env.example` lists all 9 variables from the `config.ts` contract with placeholders.
- `README.md`: env setup, schema application, how to create the single user, run scripts,
  project layout.

**Files created (matches the locked tree, plus two additions — see Decisions)**
```
.env.example
.gitignore
next.config.ts                  (outputFileTracingRoot pin — see Decisions)
supabase/migrations/0001_init.sql
scripts/                        (empty, seed script lands in Phase 1)
src/lib/config.ts               ONLY file reading process.env — verified by grep
src/lib/auth.ts                 getCurrentUser()                     [addition]
src/lib/auth-actions.ts         signInAction / signOutAction         [addition]
src/lib/supabase/client.ts      browser client (anon key)
src/lib/supabase/server.ts      RSC / route-handler client (cookies)
src/lib/supabase/admin.ts       service-role client, throws if imported client-side
src/middleware.ts               unauthenticated → /login
src/app/layout.tsx
src/app/page.tsx                "IELTS Daily — Phase 1 pending" + email + sign-out
src/app/login/page.tsx          email + password form, error display
```

**Database**
- `0001_init.sql` written verbatim from the task contract — byte-for-byte, no edits.
- Applied to project `gmmdnbsxrlojzhseaffj` on 2026-08-16. Applied cleanly on the
  first attempt against an empty `public` schema (verified 0 pre-existing tables).
- Verified post-apply: all 9 tables present (`tests`, `questions`, `units`,
  `unit_completions`, `attempts`, `vocab_words`, `vocab_cards`, `vocab_reviews`,
  `study_log`), `relrowsecurity = true` on every one, exactly one policy per table
  named `authenticated_all` with `roles = {authenticated}`, `cmd = ALL`.
- `select count(*) from units;` → `0`.

**Method used to apply the migration:** neither the SQL editor nor the CLI. The
Supabase MCP server returned `Unauthorized` on every call, and no `supabase`/`psql`
binary is installed locally. Applied instead via the Supabase Management API
(`POST /v1/projects/{ref}/database/query`) using a personal access token the user
supplied. See Open issues — this has a CLI consequence and a token-rotation action.

## Definition of Done — verification

| Item | Result |
| --- | --- |
| `npm run build` | ✅ 0 errors, 3 routes + middleware compiled |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run lint` | ✅ clean (not required, but run) |
| `0001_init.sql` applies cleanly | ✅ applied first try, no errors |
| `select count(*) from units` returns 0 | ✅ |
| `/` without session redirects to `/login` | ✅ `307 → http://localhost:3111/login` |
| `/login` renders the form | ✅ `200`, email + password inputs + submit present |
| `/` shows the user's email after login | ⚠️ **not verified by me** — needs `.env.local` + the manually created user, both user-owned steps |
| `process.env` only in `src/lib/config.ts` | ✅ 8 matches, all in `config.ts` |
| `.env.local` git-ignored | ✅ `git check-ignore .env.local` → match; `.env.example` correctly NOT ignored |

## New findings

1. **`create-next-app` refuses a non-empty directory.** `ielts-daily/` already held
   `CLAUDE.md`, `docs/`, `tasks/`, `memory/`, `content/`. Scaffolded into a temp dir
   and moved the output in. Tier: Minor.
2. **A stray directory literally named `{docs,tasks,memory,content`** existed in the
   project root — leftover from a shell brace-expansion that didn't expand. It was
   empty (only an empty `seed/` inside). Deleted. Tier: Minor.
3. **The repo was not a git repository.** `git init` was run so the `.gitignore`
   contract and the `git check-ignore` DoD item could be verified. Nothing has been
   committed — the working tree is staged but uncommitted, left for the user.
4. **A parent-directory lockfile (`/Users/vudung/package-lock.json`) made Next.js
   infer the wrong workspace root**, printing a warning on every build. Pinned with
   `outputFileTracingRoot`. Tier: Minor.
5. **Supabase MCP server is unauthorized.** Every `mcp__supabase__*` call returns
   `Unauthorized. Please provide a valid access token`. Worth fixing before Phase 1,
   which needs DB access for seeding.

## Decisions made

- **Added `src/lib/auth.ts` and `src/lib/auth-actions.ts`** beyond the locked file
  tree. The tree didn't say where auth calls live, but the CLAUDE.md invariant
  "data access goes through `src/lib/` modules, never inline Supabase calls inside
  components" forbids putting `supabase.auth.*` in the page files. Sign-in and
  sign-out are server actions, so session cookies are written server-side and the
  service of a stale client session can't desync. Logged in `discoveries.md`.
- **Login uses a server action + `useActionState`**, not a browser-client call. The
  login page is the only `"use client"` component; `/` stays a server component.
- **Dropped `next/font/google`** from the generated `layout.tsx` (and the matching
  `--font-geist-*` vars from `globals.css`). Google Fonts is a build-time network
  fetch that makes offline builds fail, and Phase 1 replaces the styling with the
  Claude Design export anyway. No visual design work was done — Non-goal respected.
- **`admin.ts` guards with `typeof window !== "undefined"`**, not the `server-only`
  package. `server-only` throws in any non-React-Server bundling context, which
  would break the Phase 1 seed script that runs under `tsx` in plain Node — and the
  seed script is exactly what `admin.ts` exists for.
- **Middleware treats `/login` and `/auth/*` as public**, redirects an authenticated
  user hitting `/login` back to `/`, and excludes `_next/static`, `_next/image`,
  `favicon.ico` and common static/audio extensions (`.mp3`, `.m4a`, `.wav` included
  ahead of Phase 2's listening audio).

## Open issues

1. **Two manual dashboard steps are still outstanding** (both flagged in README §3):
   - **Disable public signups** (Authentication → Sign In / Providers → Email).
     This matters more than it looks: the RLS policy grants `authenticated` full
     read/write on every table, so *any* account that can be created has total
     access to the whole database. Until signups are off, the anon key plus the
     project URL is enough for a stranger to self-provision that access.
   - **Create the single user** (Authentication → Users → Add user, with
     *Auto Confirm User* ticked).
   I attempted to disable signups via the Management API; the call was blocked by
   this session's permission classifier, so it remains a user step.
2. **The final DoD item is unverified.** "`/` renders and shows the user's email
   after logging in" needs `.env.local` (user-owned) and the user account from
   step 1. Everything up to the login POST is verified; please confirm this last
   hop after you fill `.env.local`.
3. **Rotate the Supabase personal access token.** The token was pasted into the chat
   transcript in plaintext. It was used only for the migration and never written to
   any file in the repo, but it should be revoked at Dashboard → Account → Access
   Tokens and re-issued into the MCP server config as `SUPABASE_ACCESS_TOKEN`.
4. **Migration history is not registered.** Because the schema was applied outside
   the CLI, `supabase_migrations.schema_migrations` has no row for `0001`. Before
   the first `supabase db push` against this project, run
   `supabase migration repair --status applied 0001`, or the CLI will re-run the
   migration and fail. Documented in README §2. (I tried to insert the row directly;
   that call was also blocked by the permission classifier.)
5. **Nothing is committed to git.** The repo is initialized with a staged working
   tree; the first commit is yours to make.

## Input for next phase (Phase 01 — roadmap engine)

- **Schema is live and empty.** All 9 tables exist and are queryable. Seeding can
  start immediately; no schema work is pending.
- **Use `createAdminClient()` from `src/lib/supabase/admin.ts`** for the seed script
  under `scripts/`. It bypasses RLS and throws if `SUPABASE_SERVICE_ROLE_KEY` is
  missing — so `.env.local` must carry the service-role key before seeding.
  `tsx` is already installed as a dev dependency.
- **Read the session in server components with `getCurrentUser()`** from
  `src/lib/auth.ts` rather than calling Supabase directly.
- **`src/app/page.tsx` is a throwaway placeholder** — Phase 1 owns it. The sign-out
  form on it should be preserved or relocated somewhere in the new layout.
- **`content/seed/week_01.json` is the only content file present.** It is
  architect-owned; if it is malformed or incomplete, log a discovery rather than
  filling gaps.
- **Roadmap pointer rule is unimplemented** (no code touches `units`/
  `unit_completions` yet) — Phase 1 implements it from scratch.
- **Tailwind 4 is installed but the theme is bare** (`globals.css` has only the
  background/foreground tokens). The Claude Design export drops in cleanly.
