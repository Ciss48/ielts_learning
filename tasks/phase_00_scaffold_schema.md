# Phase 00: Scaffold + schema + auth

## Context Recap
This is the first phase of IELTS Daily (see `docs/plan.md`): a single-user Next.js +
Supabase app for daily IELTS self-study. Nothing has been built yet. The user has
already created an empty Supabase project and a Cloudflare account; this phase only
needs Supabase. Every later phase depends on the schema defined here — treat the SQL
below as a contract, not a suggestion.

## Goal
A runnable Next.js 15 skeleton with the full database schema migrated, single-user
auth working, and all routes behind a login wall.

## Non-goals
- No test player, no roadmap logic, no seed content (Phase 1).
- No vocabulary/SRS logic beyond creating the tables.
- No Anthropic API or Cloudflare R2 wiring (env placeholders only).
- No visual design work — unstyled/default Tailwind is fine; a Claude Design export
  will be integrated in Phase 1. Do not install any UI component library.
- Do not create pages beyond `/login` and a placeholder `/`.

## Interface Contract

### File tree to create
```
ielts-daily/
├── CLAUDE.md, docs/, tasks/, memory/, content/        (already exist)
├── .env.example
├── .gitignore                  (must include .env*, !.env.example, node_modules, .next)
├── package.json                (next@15, react, typescript, tailwindcss,
│                                @supabase/supabase-js, @supabase/ssr, tsx)
├── supabase/migrations/0001_init.sql
├── src/
│   ├── lib/
│   │   ├── config.ts           ← ONLY file reading process.env
│   │   └── supabase/
│   │       ├── client.ts       ← browser client (anon key)
│   │       ├── server.ts       ← server client for RSC/route handlers (cookies)
│   │       └── admin.ts        ← service-role client, server-only (used by seed)
│   ├── middleware.ts           ← redirect unauthenticated → /login
│   └── app/
│       ├── layout.tsx
│       ├── page.tsx            ← placeholder: "IELTS Daily — Phase 1 pending"
│       └── login/page.tsx      ← email+password sign-in (no signup UI)
└── scripts/                    (empty dir, seed script comes in Phase 1)
```

### `src/lib/config.ts` (exact shape)
```ts
export const config = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",   // used from Phase 4
  r2: {                                                    // used from Phase 2
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "",
  },
} as const;
```
`.env.example` lists all of the above with placeholder values.

### `supabase/migrations/0001_init.sql` (exact schema — copy verbatim)
```sql
create table tests (
  id uuid primary key default gen_random_uuid(),
  skill text not null check (skill in ('reading','listening','writing')),
  title text not null,
  source text,
  audio_url text,
  duration_minutes int not null,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  qnum int not null,
  qtype text not null check (qtype in
    ('mcq','tfng','ynng','matching','gap_fill','short_answer','essay')),
  prompt text not null,
  options jsonb,
  answer_key jsonb,
  explanation_md text,
  unique (test_id, qnum)
);

create table units (
  id uuid primary key default gen_random_uuid(),
  seq int not null unique,
  block text not null check (block in
    ('diagnostic','foundation','skill_cycle','mock','taper')),
  skill text not null check (skill in
    ('reading','listening','writing','speaking','vocab','mixed')),
  title text not null,
  strategy_md text not null default '',
  test_id uuid references tests(id),
  est_minutes int not null default 60,
  elsa_task text,
  created_at timestamptz not null default now()
);

create table unit_completions (
  unit_id uuid primary key references units(id) on delete cascade,
  completed_at timestamptz not null default now()
);

create table attempts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id),
  test_id uuid not null references tests(id),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  answers jsonb not null default '{}'::jsonb,
  score_raw int,
  score_total int,
  band_estimate numeric(2,1),
  ai_feedback_md text
);

create table vocab_words (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete set null,
  word text not null,
  ipa text,
  meaning_en text,
  meaning_vi text,
  example text
);

create table vocab_cards (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null unique references vocab_words(id) on delete cascade,
  added_at timestamptz not null default now(),
  ease numeric not null default 2.5,
  interval_days int not null default 0,
  due_date date not null default current_date,
  reps int not null default 0,
  lapses int not null default 0
);

create table vocab_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references vocab_cards(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  grade int not null check (grade between 0 and 3)
);

create table study_log (
  day date primary key,
  minutes int not null default 0,
  units_completed int not null default 0
);

-- RLS: single-user app — authenticated role gets full access, anon gets nothing.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
```

### Auth behavior
- Supabase email+password. Public signups DISABLED (Supabase dashboard setting —
  document this in README along with "create the single user manually in the
  dashboard").
- `src/middleware.ts`: every route except `/login` and static assets requires a
  session; unauthenticated → redirect `/login`.

## Steps
1. `npx create-next-app@latest` (TypeScript, Tailwind, App Router, src dir), then add
   `@supabase/supabase-js`, `@supabase/ssr`, `tsx` (dev).
2. Create `.gitignore`, `.env.example`, `src/lib/config.ts` exactly as specified.
3. Create the three Supabase client modules (`client.ts`, `server.ts`, `admin.ts`)
   using `@supabase/ssr` patterns; `admin.ts` must throw if imported client-side.
4. Write `supabase/migrations/0001_init.sql` verbatim from the contract; apply it via
   the Supabase SQL editor or CLI (document which was used in the phase report).
5. Implement `middleware.ts` and the minimal `/login` page (email + password form,
   error message on failure, redirect to `/` on success).
6. Placeholder `/` page showing the logged-in user's email and a sign-out button.
7. Write a short `README.md`: env setup, how to create the single user, how to run.

## Definition of Done
- `npm run build` and `npx tsc --noEmit` both pass with 0 errors.
- `0001_init.sql` applies cleanly to a fresh Supabase project (no errors), and
  `select count(*) from units;` returns 0 (table exists).
- Visiting `/` without a session redirects to `/login`; after logging in with the
  manually created user, `/` renders and shows the user's email.
- Grepping the repo for `process.env` returns matches ONLY in `src/lib/config.ts`
  (and Next.js generated files).
- `.env.local` is git-ignored (verify with `git check-ignore .env.local`).

## Handoff Obligations
1. Write `memory/phase_00_report.md` (Done / New findings / Decisions made / Open
   issues / Input for next phase).
2. Overwrite `memory/STATE.md` with the current snapshot (replace, don't append).
3. If any MAJOR discovery occurred (see CLAUDE.md's 3-tier protocol), write the
   proposal into `memory/discoveries.md` and stop early rather than improvising.
