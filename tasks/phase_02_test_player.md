# Phase 02: Test player + timer + objective grading

## Context Recap
IELTS Daily (see `docs/plan.md`) is a single-user IELTS self-study app. Phase 00
built the scaffold, schema, and auth; Phase 01 built the roadmap pointer
(`src/lib/roadmap.ts`), the session player at `/unit/[seq]` (Strategy → Complete),
the idempotent seed script, and ported the design tokens from
`design/IELTS Daily.dc.html` into `globals.css`. See `memory/phase_01_report.md` —
especially its "Input for next phase" section, which this task assumes you have
read. This phase adds the **Practice step**: when a unit has `test_id`, the player
runs a timed test, grades it server-side, and shows a review screen before the
unit can be completed. Architect-provided content for this phase is
`content/seed/week_02.json` (units seq 7–12; unit 9 carries a 13-question reading
test used to verify the whole pipeline).

## Goal
A unit with a test walks through Strategy → Practice (timed, all objective
question types) → Review (score + per-question explanations) → Complete, with the
attempt persisted and `answer_key`/explanations never reaching the client before
submission.

## Non-goals
- No `essay` rendering or AI grading (Phase 5). If an `essay` question is ever
  encountered by the player, show a "not yet supported" notice and log a
  discovery — do not build anything for it.
- No vocabulary UI or SRS (Phase 4) — week_02 vocab rows are seed-only, as before.
- No ingestion pipeline, no Grok API calls, no R2 SDK (Phase 3). `tests.audio_url`
  is treated as a plain https URL.
- No mid-test resume: refreshing during Practice restarts the attempt. Acceptable
  and documented; do not build resume state.
- Listening-specific verification is deferred to Phase 3 (no listening content
  exists yet). Implement the audio path (render an `<audio>` player above the
  questions when `audioUrl` is set) but mark it untested in the phase report.
- Do not modify Phase 01's roadmap contract: `completeUnit` stays the only
  progress writer and is called exactly once, at the final Complete step.

## Interface Contract

### Migration `supabase/migrations/0002_vocab_word_key.sql` (verbatim)
```sql
-- Defensive dedupe, then natural key for upserts (fixes the Phase 01 discovery:
-- delete+reinsert cascaded away vocab_cards / SRS progress on re-seed).
delete from vocab_words a
  using vocab_words b
  where a.id > b.id and a.unit_id = b.unit_id and a.word = b.word;

alter table vocab_words
  add constraint vocab_words_unit_word_key unique (unit_id, word);
```
Apply it the same way Phase 00's migration was applied (Supabase MCP if the
rotated token is configured, otherwise ask the user to run it in the SQL editor —
do not paste tokens into chat). Note the applied method in the phase report.

### Seed script extensions (`scripts/seed.ts`)
1. **Vocab upsert change:** upsert on `onConflict: 'unit_id,word'` (keep ids
   stable → `vocab_cards` survive), then delete rows for that unit whose `word`
   is no longer in the incoming list. Remove the Phase 01 cascade warning only if
   it no longer applies.
2. **Test support.** Extended per-unit seed schema (all previous fields unchanged):
```json
{
  "seq": 9,
  "...": "...",
  "test": {
    "skill": "reading",
    "title": "...",
    "duration_minutes": 20,
    "audio_url": null,
    "content": { "passage_md": "..." },
    "questions": [{
      "qnum": 1,
      "qtype": "tfng",
      "prompt": "...",
      "options": ["TRUE", "FALSE", "NOT GIVEN"],
      "answer_key": ["true"],
      "explanation_md": "..."
    }]
  }
}
```
   Id-stable upsert rule (tests have no natural key; stability protects
   `attempts` history): if the unit's `test_id` is null → insert the test, set
   `units.test_id`; if not null → UPDATE that `tests` row in place, then delete
   its `questions` and reinsert. Never delete a `tests` row. Validate with the
   same abort-naming-the-field discipline; validate `answer_key` is a non-empty
   string array and `qnum` unique per test.

### `src/lib/band.ts`
```ts
/** Official-style raw→band conversion. Returns null unless total === 40. */
export function rawToBand(
  skill: 'reading' | 'listening', raw: number, total: number
): number | null;
```
Tables to encode (Academic):
- reading:  39–40→9.0, 37–38→8.5, 35–36→8.0, 33–34→7.5, 30–32→7.0, 27–29→6.5,
  23–26→6.0, 19–22→5.5, 15–18→5.0, 13–14→4.5, 10–12→4.0, 8–9→3.5, 6–7→3.0, ≤5→2.5
- listening: 39–40→9.0, 37–38→8.5, 35–36→8.0, 32–34→7.5, 30–31→7.0, 26–29→6.5,
  23–25→6.0, 18–22→5.5, 16–17→5.0, 13–15→4.5, 10–12→4.0, 8–9→3.5, 6–7→3.0, ≤5→2.5

### `src/lib/tests.ts` (server-only)
```ts
export type ObjectiveQType =
  'mcq' | 'tfng' | 'ynng' | 'matching' | 'gap_fill' | 'short_answer';

/** Client-safe: NO answer_key, NO explanation_md. */
export interface PlayerQuestion {
  id: string; qnum: number; qtype: ObjectiveQType;
  prompt: string; options: string[] | null;
}
export interface PlayerTest {
  id: string; skill: 'reading' | 'listening' | 'writing'; title: string;
  audioUrl: string | null; durationMinutes: number;
  content: { passage_md?: string; transcript_md?: string };
  questions: PlayerQuestion[];
}
export async function getTestForUnit(testId: string): Promise<PlayerTest | null>;

export async function startAttempt(
  unitId: string, testId: string
): Promise<{ attemptId: string; startedAt: string }>;

export interface PerQuestionResult {
  qnum: number; correct: boolean; given: string;
  expected: string[]; explanationMd: string | null;
}
export interface GradedAttempt {
  attemptId: string; scoreRaw: number; scoreTotal: number;
  bandEstimate: number | null; perQuestion: PerQuestionResult[];
}
/** Grades server-side, updates the attempt row (submitted_at, answers,
 *  score_raw, score_total, band_estimate), returns full review payload. */
export async function submitAttempt(
  attemptId: string, answers: Record<number, string>
): Promise<GradedAttempt>;

/** Pure, exported for the fixture check script. */
export function gradeAnswers(
  questions: Array<{ qnum: number; qtype: ObjectiveQType; answerKey: string[] }>,
  answers: Record<number, string>
): { scoreRaw: number; scoreTotal: number;
    perQuestion: Array<{ qnum: number; correct: boolean; given: string }> };
```
**Normalization rule (applies to both sides before comparison):** trim →
lowercase → collapse internal whitespace to single spaces. A given answer is
correct iff its normalized form equals the normalized form of ANY entry in
`answer_key`. Empty/missing answer = incorrect, `given: ""`.
**Choice-type submission rule:** for `mcq`/`tfng`/`ynng`/`matching`, the value
submitted as the answer is the selected option string EXACTLY as it appears in
`options` (the UI may display letter labels like "A)", but they are visual only
and never part of the submitted value — the seed's answer keys assume this).

### Player flow at `/unit/[seq]` (units with `testId`)
Step rail: **Strategy → Practice → Review → Complete** (Phase 01's two-step rail
stays for units without a test).
- Practice intro: title, question count, duration, "Begin" button. Begin calls
  `startAttempt` (server action), then starts the countdown.
- Countdown pill (per the design export): mm:ss, sticky; at 00:00 auto-submits
  whatever is answered. Reading layout: passage left / questions right per the
  design's split view (stacked on narrow screens).
- Submit → server action wraps `submitAttempt` → Review step: score line
  (`X / Y` + band when non-null, labeled "estimate"), per-question list with
  correct/incorrect state, the user's answer, accepted answer(s), and
  `explanation_md` rendered via `react-markdown`.
- Review → Continue → Complete step → existing `completeUnitAction` (unchanged,
  still pointer-re-validated, still called exactly once).
- Guard behavior from Phase 01 (locked redirect, done read-only) is unchanged;
  a completed test unit's read-only view may simply omit Practice.

### Fixture check script
`scripts/check_grading.ts` (run: `npx tsx scripts/check_grading.ts`): asserts
`gradeAnswers` + `rawToBand` against fixtures covering every objective qtype,
normalization ("  The Sun " ≡ "the sun"), multi-key acceptance, missing answers,
and band edge rows (e.g. reading 30/40→7.0, 29/40→6.5, 13/13→null). Exit 0 on
pass; non-zero with the failing case named.

## Steps
1. Write and apply migration `0002`; verify the unique constraint exists.
2. Extend `scripts/seed.ts` (vocab natural-key upsert + test/question support with
   validation); keep the `.env.local` self-loading preamble from Phase 01.
3. Implement `src/lib/band.ts` and `src/lib/tests.ts` per contract.
4. Write `scripts/check_grading.ts`; make it pass.
5. Seed `content/seed/week_02.json`; run it twice; verify counts.
6. Build the Practice/Review steps into `/unit/[seq]` using the design export's
   split view, countdown pill, and step rail tokens already in `globals.css`.
7. Run the Definition of Done checks; write the report.

## Definition of Done
- `npx tsx scripts/check_grading.ts` exits 0.
- Seed run twice in a row → stable counts: `units=12`, `tests=1`, `questions=13`,
  `vocab_words=16`.
- **SRS survival proof:** insert one `vocab_cards` row for an existing week-1
  word via SQL, re-run the week_01 seed, and verify the row still exists and
  references the same `word_id`. Delete the test row afterwards.
- **Id stability proof:** note unit 9's `test_id`, re-run the week_02 seed,
  `test_id` unchanged and `questions` count still 13.
- Submitting the unit-9 test with a known answer sheet (all 13 correct per the
  seed's `answer_key`s) returns `scoreRaw=13, scoreTotal=13, bandEstimate=null`;
  an all-blank submit returns `scoreRaw=0` with 13 per-question results.
- The Practice step's served HTML before submission contains no `answer_key`
  values and no `explanation_md` text (grep the page response for the distinctive
  string `Despommier popularized` — it must appear only after submission, in the
  Review payload).
- Timer auto-submit verified once (temporarily set `duration_minutes=1` in the
  DB, observe auto-submit at 00:00, restore to 20; note it in the report).
- An `attempts` row exists after the test with `submitted_at`, `answers`,
  `score_raw=13`, `score_total=13` (or the scores of your live run).
- `npx tsc --noEmit`, `npm run build`, `npm run lint` all clean; `process.env`
  still only in `src/lib/config.ts` (env-file preamble comments excepted).

## Handoff Obligations
1. Write `memory/phase_02_report.md`.
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Log Moderate/Major findings in `memory/discoveries.md`; STOP on Major.
