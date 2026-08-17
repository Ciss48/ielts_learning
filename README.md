# IELTS Daily

A single-user personal IELTS learning center: sequential roadmap, daily session
player, timed tests with grading, vocabulary SRS.

Stack: Next.js 15 (App Router) + TypeScript (strict) + Tailwind CSS 4 + Supabase.

Architecture and phase map: `docs/plan.md`. Working rules: `CLAUDE.md`.

---

## 1. Environment setup

```bash
cp .env.example .env.local
```

Fill `.env.local` with the values from your Supabase project
(Dashboard → Project Settings → API):

| Variable | Where to find it | Needed from |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | Phase 0 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` key | Phase 0 |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key | Phase 1 (seed script) |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Phase 4 |
| `R2_*` | Cloudflare dashboard → R2 | Phase 2 |

`.env.local` is git-ignored and is the **only** place secrets live.
`src/lib/config.ts` is the only file that reads `process.env`.

## 2. Database schema

The schema lives in `supabase/migrations/0001_init.sql`. Migrations are
**append-only** — never edit an applied migration; add a new numbered file.

> `0001_init.sql` has **already been applied** to the project
> (`gmmdnbsxrlojzhseaffj`) during Phase 0, via the Supabase Management API query
> endpoint. All 9 tables exist with RLS enabled and one `authenticated_all`
> policy each.

To apply it to a *different* / fresh project:

**Supabase SQL editor** — Dashboard → SQL Editor → New query → paste the contents
of `supabase/migrations/0001_init.sql` → Run.

**Supabase CLI**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Verify:

```sql
select count(*) from units;   -- expect 0
```

> **CLI caveat:** because `0001_init.sql` was applied directly rather than through
> the CLI, the project's migration-history table has no row for it. Before the
> first `supabase db push` against this project, run:
> `supabase migration repair --status applied 0001`
> otherwise the CLI will try to re-apply it and fail on "relation already exists".

## 3. Create the single user

This app has **no signup flow** by design — it serves exactly one user.
Both steps below are **manual dashboard steps and still outstanding.**

1. Dashboard → Authentication → Sign In / Providers → Email → **disable "Allow new
   users to sign up"**. Without this, anyone who finds the project URL and anon key
   can create an account, and the `authenticated_all` RLS policy would grant them
   full read/write on every table.
2. Dashboard → Authentication → Users → **Add user** → *Create new user*.
   Enter your email + password and tick **Auto Confirm User**.

That account is the only one that can sign in.

## 4. Run

```bash
npm install
npm run dev      # http://localhost:3000
```

Visiting any route without a session redirects to `/login`.

Other scripts:

```bash
npm run build      # production build
npx tsc --noEmit   # type check (must be clean before a phase is done)
npm run lint
```

## Project layout

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx            placeholder home (Phase 1 replaces it)
│   └── login/page.tsx      email + password sign-in
├── lib/
│   ├── config.ts           ONLY file reading process.env
│   ├── auth.ts             session read helpers
│   ├── auth-actions.ts     sign-in / sign-out server actions
│   └── supabase/
│       ├── client.ts       browser client (anon key)
│       ├── server.ts       RSC / route handler client (cookies)
│       └── admin.ts        service-role client, server-only
└── middleware.ts           redirects unauthenticated requests to /login

supabase/migrations/        append-only SQL migrations
content/seed/               architect-authored content (never edited by code)
scripts/                    seed script lands here in Phase 1
```
