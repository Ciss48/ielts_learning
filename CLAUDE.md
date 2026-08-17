# CLAUDE.md

## What this project is
IELTS Daily — a single-user Next.js + Supabase web app that acts as a personal IELTS
learning center: sequential roadmap, daily session player, timed tests with grading,
vocabulary SRS. Full map: `docs/plan.md`.

## Mandatory bootstrap at the start of EVERY session
1. Read `memory/STATE.md` to see where things stand.
2. Read the current phase's task file in `tasks/`.
3. If STATE.md says a prior phase logged a MAJOR discovery that hasn't been resolved
   by the user yet, ask the user before proceeding — do not guess or improvise.

## Invariant rules for this project
- **Secrets:** follow the user's `coding-standards` skill. All secrets live ONLY in
  `.env.local` (git-ignored). `src/lib/config.ts` is the ONLY file that reads
  `process.env`; everything else imports from it. Never hardcode a key, URL, or
  password. Keep `.env.example` updated with placeholder keys.
- **TypeScript strict.** No `any` in exported signatures. `npx tsc --noEmit` must
  pass before a phase is reported done.
- **Next.js App Router.** Server components by default; `"use client"` only where
  interactivity requires it. Data access goes through `src/lib/` modules, never
  inline Supabase calls inside components.
- **Migrations are append-only.** Files in `supabase/migrations/` are never edited
  after being applied — schema changes get a NEW numbered migration file.
- **Content is data, not code.** Units, tests, questions, answer keys, and vocab come
  from `content/seed/*.json`, authored by the architect. NEVER invent, modify, or
  "improve" IELTS content, questions, answer keys, or strategy text. If content is
  missing or malformed, log it as a discovery — don't fill the gap yourself.
- **Single-user app.** No `user_id` columns, no multi-tenancy, no signup flow.
- **Roadmap pointer rule:** current unit = lowest `seq` without a `unit_completions`
  row. Never insert units with `seq` ≤ max completed `seq`.
- **UI language:** English (the app itself is part of the user's immersion).
- `docs/plan.md` is only ever edited by the user + the planning model — never by an
  execution session.

## Protocol for discoveries the plan didn't anticipate
Classify anything you find into one of three tiers:
- **Minor** (local detail, doesn't affect other phases): handle it yourself, note it
  in the phase report.
- **Moderate** (an assumption was wrong but there's a clear reasonable fix, no
  architecture change): handle it yourself using best judgment, log the reasoning in
  `memory/discoveries.md`.
- **Major** (affects architecture / a later phase's contract / invalidates a
  foundational assumption in plan.md): STOP. Do not decide unilaterally and do not
  edit plan.md yourself. Write a detailed proposal into `memory/discoveries.md`, end
  the phase early, and tell the user.

## When a phase finishes (mandatory, do not skip)
1. Write `memory/phase_<N>_report.md` (template style: Done / New findings /
   Decisions made / Open issues / Input for next phase).
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Update `memory/discoveries.md` if there were any Moderate/Major findings.
