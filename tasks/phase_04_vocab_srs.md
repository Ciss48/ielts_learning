# Phase 04: Vocabulary system (triage → SRS → heatmap) + Phase 03 carry-overs

## Context Recap
IELTS Daily (see `docs/plan.md`). Phase 03 delivered the ingestion pipeline, the
test bank (6 committed reading slugs), `/bank`, and the shared validator. Read
`memory/phase_03_report.md` — especially "Input for next phase" — and the
[Phase 03] discoveries. The `vocab_words` / `vocab_cards` / `vocab_reviews` /
`study_log` tables have existed since Phase 00 and are still UI-less; 32 vocab
words are seeded (units 2, 12, 18, 24 — the latter two arrive with
`content/seed/week_03_04.json`, which the user seeds themselves). This phase
makes vocabulary a living system and closes two small Phase 03 carry-overs with
explicit architect authorization.

## Goal
The user ticks unknown words after a session, those words enter a spaced-
repetition deck, due cards appear as a Warm-up step at the start of the next
session, and the Today page shows a 12-week study heatmap + streak.

## Non-goals
- No multi-select qtype / `group_id` (that is Phase 4b, before full-paper
  ingestion — do not start it).
- No AI-generated vocabulary, definitions, or example sentences beyond carry-over
  (b) below. Word lists remain architect-authored seed data.
- No TTS/audio for words, no notifications/reminders, no editing or deleting
  words from the UI, no import/export.
- No changes to grading, the roadmap pointer, or `completeUnit` semantics.
- Warm-up must never block a session: it is skippable, and zero due cards means
  the step simply doesn't appear.

## Carry-overs from Phase 03 (do these first — Step 0)

### (a) Slash-separated answer keys — ARCHITECT AUTHORIZATION RECORDED HERE
Splitting a printed key of the form `X/Y` (or `X / Y`) into separate
`answer_key` entries for `gap_fill`/`short_answer` questions is hereby ruled a
**mechanical schema normalization, not a content edit** — the source itself
declares slash-separated variants ("Alternative answers are separated by a
slash"). CLAUDE.md has been amended to say so.
1. In `ingest.ts`'s answer-attachment step: split such keys into one entry per
   variant; log every split in review.md.
2. Re-assemble the existing source from cached logs (`--from-logs`), confirm in
   the regenerated review.md that p1–p6 still map to the same six titles
   (Phase 03 open issue §2), then re-commit — id-stable, so attempts survive.
3. Do NOT split when the slash is part of the printed answer itself (e.g. a
   fraction "1/2" or a date). Heuristic: split only when every fragment is a
   plausible standalone answer within the word limit; log ambiguous cases as
   warnings instead of splitting.

### (b) Explanation enrichment (text-only AI)
`scripts/enrich_explanations.ts content/staged/<file>.json`:
- For every question with empty `explanation_md`: one `textChat` call with the
  test's transcribed passage, the question, its options, and its verified
  answer key → a 1–2 sentence explanation that quotes the exact passage phrase
  justifying the answer. The prompt must forbid changing or second-guessing the
  key; the script must write ONLY `explanation_md` fields, nothing else —
  verify by diffing the staged file before/after (only `explanation_md` lines
  may change).
- Text-only: works on the free OpenCode Zen models; do not require vision.
- Then re-commit the staged file. Combined with (a), one re-commit covers both.

## Interface Contract

### `src/lib/srs.ts` (pure scheduler + fixtures)
```ts
export type Grade = 0 | 1 | 2 | 3;   // 0 Again, 1 Hard, 2 Good, 3 Easy
export interface CardState { ease: number; intervalDays: number;
                             reps: number; lapses: number; }
/** SM-2 lite, day-granularity. Pure. */
export function scheduleNext(s: CardState, grade: Grade): CardState;
```
Locked schedule rules (encode exactly; fixture-test in
`scripts/check_srs.ts`):
- grade 0: `lapses+1`, `reps+1`, `ease = max(1.3, ease - 0.2)`, `interval = 1`.
- grade 1: `reps+1`, `ease = max(1.3, ease - 0.15)`,
  `interval = max(1, round(interval * 1.2))`.
- grade 2: `reps+1`, ease unchanged,
  `interval = interval === 0 ? 1 : round(interval * ease)`.
- grade 3: `reps+1`, `ease = ease + 0.15`,
  `interval = interval === 0 ? 2 : round(interval * ease * 1.3)`.
- All intervals capped at 60 days. `due_date = today(Asia/Ho_Chi_Minh) + interval`.

### `src/lib/vocab.ts` (server-only)
```ts
export interface DueCard { cardId: string; wordId: string; word: string;
  ipa: string | null; meaningEn: string | null; meaningVi: string | null;
  example: string | null; }
export async function getDueCards(limit?: number): Promise<DueCard[]>; // default 20, due_date <= today, oldest due first
export async function reviewCard(cardId: string, grade: Grade)
  : Promise<{ nextDueDate: string }>;  // applies scheduleNext, inserts vocab_reviews
export async function addCards(wordIds: string[])
  : Promise<{ added: number }>;        // upsert, unique word_id → re-adding is a no-op
export interface UnitVocabWord { wordId: string; word: string; ipa: string | null;
  meaningEn: string | null; meaningVi: string | null; example: string | null;
  inDeck: boolean; }
export async function getUnitVocab(unitId: string): Promise<UnitVocabWord[]>;
```

### `src/lib/stats.ts` (server-only)
```ts
export interface HeatmapDay { day: string; minutes: number; unitsCompleted: number; }
export async function getHeatmap(weeks?: number): Promise<HeatmapDay[]>; // default 12, from study_log, gaps filled with zeros
export async function getStreak(): Promise<number>; // consecutive days ending today or yesterday with a study_log row
```

### Player step model (final form)
`Warm-up → Strategy → [Practice → Review] → [Vocab] → Complete`
- **Warm-up** appears only when `getDueCards()` is non-empty: flashcards (word →
  reveal ipa/meanings/example → four grade buttons), max 20 per session, with a
  visible "Skip warm-up" that jumps to Strategy. Reviews persist immediately per
  card (a mid-warm-up refresh loses nothing already graded).
- **Vocab** appears only when the unit has `vocab_words`: the triage list —
  every word shown with full details and a checkbox, default UNchecked, label
  "Add to my review deck". Words already in the deck render checked+disabled
  ("In your deck"). Confirm calls `addCards` with the newly checked ids only.
- Completed units render read-only as before; their Vocab step stays visible
  read-only (so the user can still see the list) but without checkboxes' submit.
- `completeUnit` semantics untouched; warm-up reviews do NOT write `study_log`.

### Today page additions
Below the unit card (per the design export): the 12-week GitHub-style heatmap
strip fed by `getHeatmap()`, and a streak counter fed by `getStreak()`. Reuse
the design tokens; do not invent a new palette (intensity steps from the accent
color are fine).

### `/vocab` page
Simple library view: total cards, due today count, then the full deck in a table
(word, meanings, due date, reps/lapses), due-first ordering. A "Review now"
button starts the same warm-up flashcard flow standalone (still capped at 20 per
run). Add a "Vocabulary" tab to `AppHeader`.

## Steps
0. Carry-overs (a) then (b); one re-commit; verify p1–p6 title stability.
1. `src/lib/srs.ts` + `scripts/check_srs.ts` fixtures (all four grades, the
   interval-0 starts, the ease floor 1.3, the 60-day cap, and a grade-0 lapse
   after a long interval).
2. `src/lib/vocab.ts`, `src/lib/stats.ts` per contract.
3. Player: Warm-up + Vocab steps wired into the step rail (both players'
   shared components where applicable — the bank player gets NO vocab/warm-up;
   it stays a pure practice surface).
4. Today page heatmap + streak; `/vocab` page; header tab.
5. DoD checks; report.

## Definition of Done
- `npx tsx scripts/check_srs.ts` exits 0.
- Carry-over (a): on `/bank/ielts-academic-reading-sample-tasks-2023-p2`,
  submitting the UK spelling and the US spelling of the q13 answer BOTH grade
  correct; review.md logged the splits; p1–p6 titles unchanged after re-commit
  (state the six titles in the report).
- Carry-over (b): every committed bank question now has a non-empty
  `explanation_md`; the staged-file diff touched only `explanation_md` fields;
  Review step displays them.
- Triage: on a unit with vocab (unit 2 is completed and read-only — use unit 12
  if uncompleted, else a bank-independent SQL check plus the read-only view),
  checking 3 of 8 words creates exactly 3 `vocab_cards`; re-confirming with the
  same words creates none (unique `word_id`); the 3 appear in `/vocab`.
- SRS flow: a card graded 2 (Good) at interval 0 gets `due_date` = tomorrow and
  a `vocab_reviews` row; graded 0 later → `lapses` incremented, ease floored at
  ≥1.3, due tomorrow. Verified against the live DB.
- Warm-up: with ≥1 due card, `/unit/[seq]` opens on Warm-up; with 0 due cards
  the step is absent; Skip works; the bank player never shows Warm-up/Vocab.
- Heatmap: `study_log` rows render as non-zero cells in the correct
  Asia/Ho_Chi_Minh day columns; days without rows render zero; streak matches a
  hand-computed value from the live `study_log`.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` clean; `process.env` only
  in `src/lib/config.ts`; no new dependency beyond what exists (build the
  heatmap by hand — no chart library).

## Handoff Obligations
1. Write `memory/phase_04_report.md`.
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Log Moderate/Major findings in `memory/discoveries.md`; STOP on Major.
