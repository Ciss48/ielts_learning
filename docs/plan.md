# Plan: IELTS Daily — personal IELTS self-study web app

## 1. Overview

**Goal:** A single-user web app that replaces an IELTS learning center for Ciss.
Every day: log in → the app shows exactly one unit (today's lesson) → strategy tips →
timed practice → auto-grading + explanations → vocabulary triage → done. Progress is
strictly sequential along a pre-built roadmap; skipping days never breaks anything —
the app always resumes at the first uncompleted unit.

**Study parameters (locked):** current level 5.5 / Aptis B2 → target **7.0** in
**~24 weeks** at **1–1.5 h/day**, 6 units/week (1 flex/rest day). ≈ 144 units total.

**In scope:** roadmap engine, daily session player, reading/listening test player with
exam timer and objective auto-grading, AI writing feedback (Claude API), vocabulary
triage + SRS + heatmap, content ingestion tool, progress dashboard.

**Out of scope (project-level non-goals):** multi-user support, mobile native app,
speaking auto-grading (speaking stays in ELSA as scheduled checklist tasks — ELSA has
no public API), payment/sharing features, offline mode, redistribution of copyrighted
materials (private personal use only).

## 2. High-level architecture

```
Browser (Next.js on Vercel)
  ├── / (Today)  /unit/[seq]  /roadmap  /vocab  /dashboard  /admin/ingest
  │
  ├── Supabase ──── Postgres: units, tests, questions, attempts,
  │                 unit_completions, vocab_*, study_log
  │                 Auth: single account, signups disabled, RLS = authenticated only
  │
  ├── Cloudflare R2 ── listening audio (mp3), source PDFs   [from Phase 2]
  │
  └── Anthropic API ── writing grader, on-demand explanations,
                       ingestion (raw test text → lesson JSON)  [from Phase 4]
```

**Locked tech decisions (do not change casually):**
- **Next.js 15 App Router + TypeScript strict + Tailwind**, deployed on Vercel — same
  stack as the user's Diary and Discipline Tracker apps; maximizes reuse of known
  patterns.
- **Supabase** for Postgres + auth. Single user: no `user_id` columns, no
  multi-tenancy. RLS enabled with a blanket `authenticated` policy; public signups
  disabled.
- **Cloudflare R2** for media (S3-compatible SDK, zero egress, 10 GB free). AWS S3
  rejected: egress cost, no benefit at this scale. Not needed until Phase 2.
- **Anthropic API** (`claude-sonnet-4-6`) for writing feedback and content ingestion.
  Band estimates from AI are **directional (±0.5)** and must be labeled as estimates
  in the UI.
- **Secrets discipline** per the user's coding-standards skill: all secrets live in
  `.env.local`; `src/lib/config.ts` is the ONLY file that reads `process.env`.

**Key design decisions:**
- **Roadmap = ordered rows, progress = pointer.** `units.seq` is a unique integer.
  Current unit = lowest `seq` with no row in `unit_completions`. No date-based
  scheduling. Rule: never seed a unit with `seq` lower than the max completed `seq`.
- **Content is data, not code.** Units/tests/questions/vocab arrive as JSON seed files
  in `content/seed/`, authored **only by the architect** (planning session), delivered
  in ~2-week batches, upserted idempotently by `seq`. The executor (Claude Code) never
  invents IELTS content, questions, or answer keys. Phase 5 replaces manual batches
  with an AI ingestion tool.
- **Session player is a step machine:** Warm-up (SRS, Phase 3) → Strategy → Practice
  (test player, Phase 2) → Review/grade → Vocab triage (Phase 3) → advance pointer.
  Phases progressively light up steps; Phase 1 ships Strategy → Complete only.

## 3. Roadmap content structure (domain spec, locked)

| Block | Weeks | Focus |
|-------|-------|-------|
| 0 Diagnostic | wk 3* | Full mock (delivered with Phase 2 test player), calibrates weights |
| 1 Foundation | wk 1–2, 4–5 | Grammar-for-writing, paraphrasing, academic vocab, question-type intros |
| 2 Skill cycles | wk 6–19 | Weekly rotation: R ×2, L ×2, W ×2, review ×1; 15′ ELSA task daily |
| 3 Mock block | wk 20–23 | One full timed mock/week + error-log review units |
| 4 Taper | wk 24 | Light review only |

*Diagnostic runs in week 3 (not week 1) because the test player ships in Phase 2;
weeks 1–2 are foundation units that need no player. At 5.5 the expected weak points
are Writing and vocabulary range; Block 2 weighting is adjusted after the diagnostic.

## 4. Phase list

### Phase 0: Scaffold + schema + auth — [HAS DETAILED TASK FILE]
Runnable Next.js skeleton, full Supabase schema migration, single-user auth with
route protection. Comes first: every later phase depends on the schema contract.

### Phase 1: Roadmap engine + session player — [HAS DETAILED TASK FILE]
The pointer mechanic (`getCurrentUnit` / `completeUnit` / `getRoadmap`), Today screen,
minimal session player (Strategy → Complete), idempotent seed script, week 1 content
seeded. Deliverable: the daily habit loop is usable end-to-end.

### Phase 2: Test player + timer + objective grading — [SKETCH ONLY]
Render reading passages / listening audio (R2), exam-mode countdown timer, answer
sheet for mcq/tfng/matching/gap-fill, auto-grade against `answer_key`, show
per-question explanations. Diagnostic mock content batch delivered here.

### Phase 3: Vocabulary system — [SKETCH ONLY]
Post-test vocab triage (tick unknown words only), SM-2-lite SRS queue feeding the
session warm-up step, GitHub-style study heatmap from `study_log`.

### Phase 4: AI integration — [SKETCH ONLY]
Writing grader (Claude API, band-descriptor rubric prompt, structured feedback),
on-demand "explain why my answer is wrong" for R/L questions.

### Phase 5: Content ingestion tool — [SKETCH ONLY]
`/admin/ingest`: paste raw test text + answer key → Claude API returns lesson JSON in
the seed schema → preview → insert. Replaces manual seed batches.

### Phase 6: Dashboard + polish — [SKETCH ONLY]
Band trajectory per skill from `attempts`, streaks, error-type breakdown, taper-week
readiness view.

## 5. Risks / assumptions to validate early

1. **Content cadence is the schedule risk, not code.** Mitigation: 2-week seed
   batches + Phase 5 ingestion tool; Phase 1 ships with real week-1 content so
   studying starts immediately.
2. **Pointer semantics** assume units are only appended (never inserted below the max
   completed seq). Validated by Phase 1 DoD.
3. **AI writing band estimates** may drift from official grading — always shown as
   estimates; calibrate against the week-3 diagnostic and any official mock results.
4. **Copyright:** source materials stored privately in R2, single user, never
   redistributed. Strategy lessons are original content written by the architect.
5. **ELSA has no API** — ELSA tasks are checklist strings on units; completion is
   self-reported. Acceptable for a personal tool.

## 6. Plan change log

| Date | Change | Reason | Source |
|------|--------|--------|--------|
| 2026-08-16 | Initial plan | — | — |
