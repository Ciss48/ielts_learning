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
| `AI_BASE_URL` | any OpenAI-compatible endpoint (optional; defaults to Groq) | Phase 3 |
| `AI_API_KEY` | your AI provider's dashboard | Phase 3 |
| `AI_MODEL` | the model id at that provider (optional; has a default) | Phase 3 |
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
Both steps below are manual dashboard steps, and both are **done** (confirmed
before the Phase 06 deployment).

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

## 5. Deployment (Vercel)

The app is deployed on Vercel from this repository.

- **Production URL:** _(fill in once the project is created — see below)_
- **Repository:** `Ciss48/ielts_learning`, branch `main`. The Next.js app is at
  the repository root, so Vercel's **Root Directory** is `./`.
- **`git push` to `main` deploys.** There is no separate release step: Vercel
  builds every push to `main` and promotes it to production. A push to any other
  branch produces a preview deployment, which is safe — it talks to the same
  Supabase project, so treat a preview as live data, not a sandbox.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, for the
Production environment (and Preview, if you use preview deployments). They are
the same names as `.env.local`; `src/lib/config.ts` is still the only file that
reads `process.env`.

| Variable | Needed at | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | **build** and runtime | `NEXT_PUBLIC_*` is inlined into the client bundle at build time, so it must be set *before* the first build or the deployed app cannot reach Supabase. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **build** and runtime | Same. |
| `AI_API_KEY` | runtime | Required. Without it, essay grading and explain-my-answer fail on first use. |
| `AI_BASE_URL` | runtime | Optional — omit to use the Groq default in `config.ts`. |
| `AI_MODEL` | runtime | Optional — same. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | runtime | Only needed to serve private listening audio. The bank has no listening tests yet. |

**`SUPABASE_SERVICE_ROLE_KEY` is deliberately NOT set in Vercel.** Nothing under
`src/` imports `src/lib/supabase/admin.ts` — the service-role client is used only
by the local `scripts/`, which never run on Vercel. Leaving it out of the
deployed environment means a bug in the app cannot reach past RLS.

**Changing an env value takes effect on the next deployment, not immediately.**
After editing one in the Vercel UI, redeploy (Deployments → ⋯ → Redeploy). For
the two `NEXT_PUBLIC_*` values this is not optional — they are baked into the
bundle.

### Function timeouts

Grading one essay is a model call measured at 18–94 seconds, and a malformed
reply costs a second call. `export const maxDuration = 300` is therefore set on
the two route segments that own an AI server action:

- `src/app/unit/[seq]/page.tsx`
- `src/app/bank/[slug]/page.tsx`

A server action runs in the function serving its own route segment, so the limit
belongs on those pages and not on the `"use server"` files. 300s is the
Fluid-compute maximum on the Hobby plan; the app never approaches it, because
`src/lib/ai.ts` gives up first.

### Before deploying

1. `.env*` is git-ignored (`!.env.example` is the only exception) — check with
   `git check-ignore -v .env.local`.
2. Supabase public signups are **disabled** (§3). The RLS policy is
   `authenticated_all`, so any account that can be created gets full read/write.
3. Exactly one confirmed user exists in Authentication → Users.
4. `npm run check && npx tsc --noEmit && npm run lint && npm run build` is clean.

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
