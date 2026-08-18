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
| 0 Diagnostic | wk 7* | Full mock (real ingested papers), calibrates weights |
| 1 Foundation | wk 1–6 | Grammar-for-writing, paraphrasing, academic vocab, question-type deep-dives (wk 3–4: bank p1–p6; wk 5–6: bank p8–p12 + guided essays via Phase 5) |
| 2 Skill cycles | wk 8–19 | Weekly rotation: R ×2, L ×2, W ×2, review ×1; 15′ ELSA task daily |
| 3 Mock block | wk 20–23 | One full timed mock/week + error-log review units |
| 4 Taper | wk 24 | Light review only |

*Diagnostic targets week 7 — or as soon as the user's Cambridge papers are
ingested, whichever comes first; the pointer-based roadmap makes the date
flexible without breaking anything. Phase 4b (multi-select support + durable
title rule) must land before full-paper ingestion. Weeks 1–2 are foundation
units with an architect-written fixture test; weeks 3–6 are question-type
deep-dives wired to the ingested sample-task bank plus guided essays once
Phase 5 ships. At 5.5 the expected weak points are Writing and vocabulary
range; Block 2 weighting is adjusted after the diagnostic.

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

### Phase 3: Batch content ingestion pipeline — [HAS DETAILED TASK FILE]
CLI pipeline (source PDFs are always supplied by the user, never fetched by
Claude): `content/raw/*.pdf` → vision extraction (provider-agnostic
OpenAI-compatible API; Groq by default) → staged JSON + human-readable review
summary in `content/staged/` → user confirms → commit script upserts into a
**test bank**: `tests` rows keyed by a new unique `slug` (migration `0003`),
independent of units. Units gain `test_ref: <slug>` in the seed schema so
architect-authored roadmap batches can attach bank tests. Listening audio
uploads to a private R2 bucket and is served via server-side presigned URLs.
A minimal `/bank` area lets the user browse and practice any bank test outside
the roadmap (attempts with `unit_id = null`, pointer untouched). **Staging is
mandatory** — AI-extracted answer keys never reach the DB without the shared
validator and the user's review.

### Phase 4: Vocabulary system + Phase 03 carry-overs — [HAS DETAILED TASK FILE]
Post-session vocab triage (tick unknown words only), SM-2-lite SRS deck feeding a
Warm-up step, `/vocab` library, GitHub-style heatmap + streak on Today from
`study_log`. Step 0 closes two Phase 03 carry-overs under recorded architect
rulings: slash-separated answer keys are split (schema normalization, not a
content edit) and empty explanations are enriched via a text-only AI pass, then
one id-stable re-commit.

### Phase 4b: Full-paper readiness (multi-select) — [SKETCH ONLY — run before
diagnostic ingestion]
Step 0: durable title rule — ingestion derives a test's display title from the
passage's own title when one exists (running-heading/task-type only as
fallback), plus a one-time re-title of the committed bank (interim SQL applied
by the user on 2026-08-17 restored p3–p6's passage titles). Then migration
`0004`: `questions.group_id` (nullable) + qtype `multi_select`. "Choose TWO
letters, in either order" = N grouped question rows sharing options and a
combined key set; grading compares the user's selections for the group as a
set (a letter cannot count twice), awarding 1 mark per question row so raw
totals and `rawToBand` stay exact for 40-question papers. Ingest/validator/
player support included. Written when the user's Cambridge papers are ready to
ingest; p7 from the sample source unblocks then too; p13 (diagram labelling)
stays permanently excluded — fabricated keys plus a task type the player will
not render.

### Phase 5: AI writing grading + explain-my-answer — [HAS DETAILED TASK FILE]
Writing tests as bank content (top-level `tests[]` seeding, essay validator
rules, described-data Task 1 prompts — no chart images by ruling), timed essay
flow with live word count, rubric grading via `textChat` (four criteria,
code-computed overall labeled "AI estimate ±0.5", refusal under 50 words,
length notes), feedback persisted to `attempts`; plus ephemeral
"why is my answer wrong?" on incorrect objective questions. Budgets against
the same daily token pool as ingestion.

### Phase 6: Grader calibration + dashboard + deployment — [HAS DETAILED TASK FILE]
Step 0: essay-grader calibration (rubric v2 with per-criterion verbatim error
inventories and evidence-tied band caps; LR cap code-enforced) and a
grading-wait UX. Then `/dashboard` (skill trajectories, question-type weakness
table recomputed from stored answers via the one grading implementation,
totals incl. longest streak), per-test attempt history in `/bank` (essay rows
render stored `ai_feedback_md`), and **Vercel deployment** behind the existing
login — with the git commit+push of Phases 02–05 as an explicit prerequisite
gate. Taper-week readiness view deferred to a pre-mock mini-phase, when mock
data exists to feed it. Attempts filtering: trajectories label roadmap vs bank;
`study_log`-derived totals stay roadmap-only by construction.

## 5. Risks / assumptions to validate early

1. **Content cadence is the schedule risk, not code.** Mitigation: Phase 3 (moved
   up) delivers a batch ingestion pipeline right after the test player ships, so a
   real content bank exists before the heavy skill-cycle weeks; Phase 1 also ships
   with real week-1 content so studying starts immediately regardless.
2. **Batch ingestion accuracy.** AI extraction from scanned PDFs can misread a
   passage, question, or — critically — an answer key. Mitigation: Phase 3 always
   writes to a staged review file, never directly to the database; the user
   confirms before the real insert.
3. **Ingestion throughput is bounded by the free AI tier** (~45–50 source pages
   per day on Groq's 200k-token daily pool, shared with Phase 5's writing
   grader). Mitigation: ingest in batches matching the 2-week content cadence;
   a paid tier is the escape valve if the mock block needs a burst.
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
| 2026-08-17 | Phase 03 task file written. AI config is provider-agnostic (`AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`, OpenAI-compatible; Groq default) instead of a Grok-specific key | "Grok (như dự án Diary)" ambiguity: the Diary project uses Groq (groq.com), not xAI's Grok; both expose OpenAI-compatible APIs so one client covers either | User clarification, pre-Phase 03 |
| 2026-08-17 | Test bank introduced: `tests.slug` (migration `0003`), `test_ref` in the unit seed schema, `/bank` practice area with `unit_id = null` attempts; Phase 02's answer-key⊆options finding promoted to a hard rule in a shared validator | Ingested tests must exist independently of the roadmap so architect batches can reference them; free practice outside the pointer was a natural byproduct and the verification surface for ingestion | memory/phase_02_report.md findings §4, Phase 02 review |
| 2026-08-17 | Phase 03 accepted. Three architect rulings: (1) slash-separated answer keys are split — schema normalization, not content editing; (2) multi-select is a real schema gap → new Phase 4b (`group_id` + set-based group grading) scheduled before diagnostic ingestion; (3) missing explanations fixed by a text-only enrichment pass. Diagnostic moves to week 5; weeks 3–4 become question-type deep-dives on the six ingested sample-task slugs | The ingested bank is single-task extracts (perfect for type deep-dives, wrong shape for a mock); full papers await the user's Cambridge books and multi-select support; ruling (1) resolves the executor's correctly-escalated fidelity question | memory/phase_03_report.md, Phase 03 review |
| 2026-08-17 | Phase 04 task file written: vocabulary system (SM-2-lite locked schedule, warm-up capped at 20, triage default-unchecked) + the two carry-overs as Step 0 | Vocab tables have been schema-only since Phase 00; 32 words are now seeded and week 5's diagnostic should benefit from a working review loop | Phase 03 review |
| 2026-08-17 | `ingest.ts` patched to detect a PDF's text layer and use a text-only AI call (`textChat`) instead of `visionChat` whenever one exists — vision is now reserved for genuinely scanned sources | Phase 03 routed a born-digital PDF (with a provably clean text layer — the fidelity spot-check itself used `pdftotext`) through vision unconditionally, which burned the shared vision-only rate budget for no accuracy benefit and blocked ingestion on OpenCode Zen's vision-less free tier | User question, pre-Phase 04 |
| 2026-08-17 | Patch + Phase 04 accepted. Rulings: bank display titles = passage titles (interim SQL for p3–p6 now; durable derivation rule in Phase 4b Step 0); p13 permanently excluded (fabricated keys, unrenderable task type); unit 17 relabeled Flow-chart Completion (architect's own mislabel — p3 was never sentence completion). Bank stands at 11 reading tests / 46 questions, all keyed and explained | memory/phase_03_patch_report.md + memory/phase_04_report.md open issues | Phase 04 review |
| 2026-08-17 | Phase 05 task file written: writing as bank content (3 architect-authored tests in `writing_bank_01.json`), essay flow + rubric grading with code-computed overall band, <50-word refusal, ephemeral explain-my-answer; foundation block extended to wk 1–6 (p8–p12 + guided essays), diagnostic → wk 7 or on Cambridge arrival | Writing is the expected weakest skill at 5.5 and needs no Cambridge content; Phase 4b waits for the books | Phase 04 review |
| 2026-08-18 | Phase 05 accepted. Ruling on grader generosity (live sample scored ~1 band high despite the honesty rubric): rubric v2 with per-criterion verbatim error inventories listed before banding, evidence-tied caps (≥3 LR errors → ≤6.0 with a code-enforced clamp; mechanical linking → CC ≤6.5; errors in >⅓ of sentences → GRA ≤6.0; unaddressed task part → TR ≤5.0). Comments/top-fixes are the product; the number stays labeled ±0.5 | An inflated band corrupts the user's progress signal — the single thing the diagnostic and mock blocks exist to measure | memory/phase_05_report.md, Phase 05 review |
| 2026-08-18 | Phase 06 task file written (final phase of the original plan): Step 0 calibration + wait UX, `/dashboard`, `/bank` attempt history, Vercel deployment with the git commit+push of Phases 02–05 as a prerequisite gate; taper-readiness view deferred to a pre-mock mini-phase | The app must stop depending on a dev server to fulfil "open the site anywhere, every day"; four phases of uncommitted work is the project's largest standing risk | Phase 05 review |
