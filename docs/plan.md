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
- **Grok API** (via OpenRouter or xAI direct, same pattern as the user's Diary
  project) for writing feedback and content ingestion — swapped from Anthropic API
  on 2026-08-16 for cost (Anthropic API is paid per-token; the user already has a
  working Grok integration from Diary). Both use cases only need structured
  text/JSON output, no Claude-specific capability, so the swap is a drop-in client
  change with no architecture impact. Band estimates from AI are **directional
  (±0.5)** and must be labeled as estimates in the UI.
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

*Diagnostic runs once Phases 2–3 have shipped: the test player (Phase 2) plus the
first real ingested tests (Phase 3) — target week 3–4. It is assembled from the
user's own real tests via the ingestion pipeline rather than architect-authored,
for authentic difficulty. Weeks 1–2 are foundation units that need no player. At
5.5 the expected weak points are Writing and vocabulary range; Block 2 weighting
is adjusted after the diagnostic.

## 4. Phase list

### Phase 0: Scaffold + schema + auth — [HAS DETAILED TASK FILE]
Runnable Next.js skeleton, full Supabase schema migration, single-user auth with
route protection. Comes first: every later phase depends on the schema contract.

### Phase 1: Roadmap engine + session player — [HAS DETAILED TASK FILE]
The pointer mechanic (`getCurrentUnit` / `completeUnit` / `getRoadmap`), Today screen,
minimal session player (Strategy → Complete), idempotent seed script, week 1 content
seeded. Deliverable: the daily habit loop is usable end-to-end.

### Phase 2: Test player + timer + objective grading — [HAS DETAILED TASK FILE]
Practice step inside the session player: reading split view, exam countdown timer,
renderers for all objective question types, server-side grading against
`answer_key` (keys and explanations never shipped to the client pre-submit),
attempt persistence, review screen with explanations. Seed script extended to
tests/questions with id-stable upserts, plus the vocab natural-key fix
(migration `0002`, from the Phase 01 discovery). Week-2 architect batch includes
a 13-question mini reading test as the grading verification fixture. Listening
audio path implemented but content-verified in Phase 3.

### Phase 3: Batch content ingestion pipeline — [SKETCH ONLY, moved up from old
Phase 5 per user request 2026-08-17 — needs a real content bank before the heavy
skill-cycle weeks (wk 6+), not after]
CLI pipeline, not an in-app tool: point it at `content/raw/` (a folder the user
drops PDFs into — scanned or text, source is always the user, never fetched by
Claude). For each file: render pages to images → Grok vision extracts passage/
audio-script text, questions, options, and answer key into the Phase 0 schema →
write to `content/staged/<file>.json` (NOT the database). A second script reviews
and bulk-upserts staged files via the Phase 1 seed script's upsert logic, keyed by
`seq` assigned by the user in a simple manifest. Listening tests: audio file must
share the PDF's basename (e.g. `test01.pdf` + `test01.mp3`) and gets uploaded to R2
during the same run. **Staging is mandatory, not optional** — auto-inserting
AI-extracted answer keys straight into the DB risks teaching the user a wrong
answer with no visible sign it happened.

### Phase 4: Vocabulary system — [SKETCH ONLY] *(was Phase 3)*
Post-test vocab triage (tick unknown words only), SM-2-lite SRS queue feeding the
session warm-up step, GitHub-style study heatmap from `study_log`.

### Phase 5: AI writing grading + explanations — [SKETCH ONLY] *(was Phase 4;
ingestion split out to Phase 3)*
Writing grader (Grok API, band-descriptor rubric prompt, structured feedback),
on-demand "explain why my answer is wrong" for R/L questions. Reuses the Grok
client wiring introduced in Phase 3.

### Phase 6: Dashboard + polish — [SKETCH ONLY]
Band trajectory per skill from `attempts`, streaks, error-type breakdown, taper-week
readiness view.

## 5. Risks / assumptions to validate early

1. **Content cadence is the schedule risk, not code.** Mitigation: Phase 3 (moved
   up) delivers a batch ingestion pipeline right after the test player ships, so a
   real content bank exists before the heavy skill-cycle weeks; Phase 1 also ships
   with real week-1 content so studying starts immediately regardless.
2. **Batch ingestion accuracy.** AI extraction from scanned PDFs can misread a
   passage, question, or — critically — an answer key. Mitigation: Phase 3 always
   writes to a staged review file, never directly to the database; the user
   confirms before the real insert.
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
| 2026-08-16 | Anthropic API → Grok API for writing feedback (Phase 4) and content ingestion (Phase 5) | Cost — Anthropic API is paid; user has a working Grok setup from the Diary project | User request, pre-Phase 01 |
| 2026-08-17 | Content ingestion moved from Phase 5 to Phase 3 (right after the test player); redesigned from an in-app paste tool to a CLI batch pipeline reading a folder of PDFs (Grok vision), with mandatory staged-review before DB insert | User wants a content bank in place before the heavy skill-cycle weeks (wk 6+), not sourced/pasted one test at a time; scanned PDFs need vision extraction, not text paste. Old Phase 3 (Vocabulary) and Phase 4 (AI writing/explanations) renumbered to 4 and 5 | User request, pre-Phase 02 |
| 2026-08-17 | Phase 02 task file written. `vocab_words` seeding switches from delete+reinsert to natural-key upsert on `(unit_id, word)` via migration `0002` | Phase 01 discovery: the delete cascades away `vocab_cards` (SRS progress) on every re-seed; fixing it while `vocab_cards` is still empty is free | memory/discoveries.md [Phase 01] |
| 2026-08-17 | Diagnostic mock (Block 0) is assembled from the user's real ingested tests, not architect-authored; week-2 batch carries a 13-question architect-written mini test purely as the grading verification fixture | Real Cambridge-style tests have authentic difficulty; synthetic full mocks would mis-calibrate the diagnostic | Phase 01 review |
