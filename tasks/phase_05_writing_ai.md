# Phase 05: AI writing grading + explain-my-answer

## Context Recap
IELTS Daily (see `docs/plan.md`). Phase 04 delivered the vocabulary system and
re-committed the bank (11 reading tests, 59/59 questions with explanations).
Read `memory/phase_04_report.md` — especially "Input for next phase" — and the
[Phase 04] discoveries. `src/lib/ai.ts` (`textChat`), the shared validator, the
bank seeding path and `enrich_explanations.ts`'s guard pattern all exist. This
phase makes Writing a first-class skill: essay tests with a timed writing flow,
AI rubric grading via the provider-agnostic text API, and a personalized
"why is my answer wrong?" for objective questions. Architect content for this
phase: `content/seed/writing_bank_01.json` (3 writing tests, bank-seeded).

## Goal
The user opens a writing test (from a unit or `/bank`), writes against a timer
with a live word count, submits, and receives structured band-descriptor
feedback (four criteria, overall estimate, concrete fixes) stored on the
attempt. On any incorrectly answered objective question, one click produces an
explanation addressing their specific wrong answer.

## Non-goals
- No Speaking features. No chart images for Task 1 — **architect ruling: Task 1
  prompts use described data (markdown tables) only**; image rendering is out of
  scope for the whole project unless re-planned.
- No revise-and-resubmit loop: one grade per attempt; trying again = a new
  attempt. No essay version history (Phase 6 shows attempt lists).
- No persistence for explain-my-answer responses — ephemeral display only, and
  it must never modify stored attempts, questions, or keys.
- No AI-generated writing *prompts* — writing tasks are architect-authored seed
  content like everything else.
- No changes to objective grading, SRS, or the roadmap contract. The bank
  player stays vocab-free.
- Warm-up/Vocab steps do not appear around bank writing practice (existing
  rule: bank is a pure practice surface).

## Interface Contract

### Seed extension — top-level `tests[]` (bank seeding)
`scripts/seed.ts` accepts an optional top-level `"tests"` array; each entry is
the embedded-test shape PLUS a required `slug`. Upsert by slug with the same
id-stable discipline as `ingest_commit.ts` — share that code, don't duplicate
it. Units' `test_ref` can then reference these slugs (unchanged mechanism).

### Validator — `essay` rules (shared validator)
For `qtype: "essay"`: `answer_key` MUST be `[]` (the non-empty hard rule is
inverted for this qtype), `options` null, `explanation_md` null allowed. A test
whose `skill` is `writing` must contain exactly one question, and it must be an
essay; its `content` requires `task_type` (`"task1" | "task2"`), `min_words`
(positive int), and non-empty `prompt_md`. Objective rules are untouched.

### `src/lib/writing.ts` (server-only)
```ts
export interface WritingCriterion {
  name: 'TR' | 'CC' | 'LR' | 'GRA';       // Task Response/Achievement, Coherence
  band: number;                            // 0–9 in 0.5 steps
  comment: string;                         // 2–4 sentences, quotes the essay
}
export interface WritingFeedback {
  overallBand: number;                     // computed in CODE: mean of the four,
                                           // rounded to nearest 0.5 — never
                                           // trust a model-supplied average
  criteria: WritingCriterion[];            // exactly 4, TR/CC/LR/GRA order
  topFixes: string[];                      // 3–5 highest-impact actions
  improvedSentences: Array<{ original: string; improved: string; reason: string }>;
                                           // ≤3, original must be verbatim from the essay
  lengthNote: string | null;               // set when under min_words
}
export async function gradeEssay(input: {
  taskType: 'task1' | 'task2'; promptMd: string;
  essay: string; minWords: number;
}): Promise<WritingFeedback>;
export function countWords(text: string): number;  // pure; whitespace-split,
                                           // hyphenated word = 1, number = 1
```
- `< 50` words: the caller refuses BEFORE any AI call (no token spend); the
  attempt stays unsubmitted and the UI says why.
- One `textChat` call using the Appendix rubric prompt; `parseModelJson`; on
  invalid shape retry once with the parse error appended; then fail visibly.
- Validate the response: 4 criteria in order, bands snapped to 0.5 in [0,9],
  `original` strings present verbatim in the essay (drop any that aren't).

### `submitEssayAttempt` (in `src/lib/tests.ts` or a sibling — keep the
answer-key split rule intact: this path never touches `answer_key`)
```ts
export async function submitEssayAttempt(attemptId: string, essay: string)
  : Promise<{ feedback: WritingFeedback }>;
```
Stores `answers = {"essay": <verbatim text>}`, `submitted_at`,
`band_estimate = overallBand`, `score_raw/score_total = null`, and
`ai_feedback_md` = a markdown rendering of the full feedback (so Phase 6 can
display history without re-parsing JSON). `startAttempt` is reused as-is.

### Player — essay flow
When a test's single question is an essay, the Practice step renders the
writing panel instead of the question list: `prompt_md` (markdown, tables
included), a plain textarea (no rich text), a live word counter that turns
accent-colored at `min_words`, the existing countdown pill (20/40 min from
`duration_minutes`), and Submit. Timer expiry auto-submits like Phase 02
(if under 50 words at expiry: save nothing, show the refusal state).
After grading, the Review step shows: overall band **labeled "AI estimate
±0.5"**, the four criteria with comments, top fixes, improved sentences, and
`lengthNote` when present. Unit flow then continues to Complete as usual; in
`/bank`, writing tests appear with the Writing badge and show `band_estimate`
(not a score fraction) in the best-result column.

### Explain-my-answer (objective questions, Review step)
On each INCORRECT question in any review panel (unit or bank), a button
"Why is my answer wrong?" calls a server action →
`explainMyAnswer(attemptId, qnum)` → one `textChat` with the passage, the
question, its options, the verified key + stored explanation, and the user's
stored `given` answer → returns 2–5 sentences addressing that specific wrong
answer (why it's tempting, why the text rules it out). Rendered inline,
ephemeral, never persisted; the action re-reads everything from the DB and
writes nothing (assert: the attempts row is byte-identical after). The prompt
forbids disputing the key. Correct questions get no button.

## Steps
1. Validator essay rules + seed `tests[]` support (shared with commit code);
   seed `content/seed/writing_bank_01.json`; run twice, verify id stability.
2. `countWords` + `gradeEssay` with response validation; add fixture coverage
   for `countWords` and the band-snapping/verbatim-original filters to
   `npm run check` (mock the model — no live AI in fixtures).
3. `submitEssayAttempt`; essay panel + feedback panel in the shared practice
   components; `/bank` writing display.
4. Explain-my-answer action + button.
5. Live end-to-end run (see DoD); report, including rough token usage.

## Definition of Done
- `npm run check` green (existing suites + the new writing fixtures).
- Seed `writing_bank_01.json` twice → 3 writing tests with stable ids, 3 essay
  questions; `/bank` lists them under a Writing badge.
- Live essay flow on `writing-t2-university-fees`: submitting a ≥250-word
  sample essay (the executor MAY write this sample — it is test input, not
  IELTS content; note this authorization) returns feedback with exactly 4
  criteria, every band in 0.5 steps, overall equal to the code-computed mean,
  and the attempts row carries `band_estimate`, `ai_feedback_md`,
  `answers.essay` verbatim, `score_raw IS NULL`.
- A 30-word submission is refused with zero AI calls (instrument or log-check);
  the attempt remains unsubmitted.
- A ~120-word Task 2 submission produces a non-null `lengthNote`.
- Explain-my-answer: on a deliberately wrong objective answer, the button
  returns an explanation that references the user's given answer; the attempts
  row is byte-identical before/after; correct questions show no button.
- Objective grading untouched: re-run the Phase 02 known-answer check on
  `/unit/9`'s test data (13/13 and 0/13 paths) at the library layer.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` clean; `process.env`
  only in `src/lib/config.ts`; no new dependency.

## Handoff Obligations
1. Write `memory/phase_05_report.md` (include rough token usage per graded
   essay, so the shared daily pool can be budgeted against ingestion).
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Log Moderate/Major findings in `memory/discoveries.md`; STOP on Major.

## Appendix — rubric prompt (base text, architect-authored)
System/prefix for the grading call. Adapt only mechanical parts (task type,
min words, the essay itself). Do not weaken the honesty rules.

```
You are an experienced IELTS examiner grading one candidate essay. Grade
honestly against the official band descriptors — do NOT inflate. Most essays
from intermediate learners genuinely sit between band 5.0 and 6.5; award 7+
on a criterion only when the descriptor is truly met.

Criteria (score each 0-9, half bands allowed):
1. TR — Task Response (Task 2) / Task Achievement (Task 1): Does it address
   ALL parts of the task? Is the position clear and consistent (T2)? Is there
   an overview and are key features selected accurately with data (T1)? An
   under-length response cannot score above 5 here; note it.
   Off-topic or memorised-template content caps TR at 4.
2. CC — Coherence and Cohesion: logical paragraphing (one central idea each),
   natural linking (penalize mechanical overuse of connectors), clear
   progression.
3. LR — Lexical Resource: range AND precision. Reward accurate, natural
   collocation; penalize misused "impressive" words more than plain correct
   ones, and penalize spelling errors that strain reading.
4. GRA — Grammatical Range and Accuracy: variety of structures AND the
   proportion of error-free sentences. Frequent basic errors cap this at 5.5.

Rules:
- Every criterion comment must quote at least one short phrase from the essay
  as evidence (positive or negative).
- topFixes: the 3-5 changes that would raise the band fastest, concrete and
  actionable, ordered by impact.
- improvedSentences: up to 3. "original" must be copied VERBATIM from the
  essay; "improved" fixes it at the target of band 7, staying in the
  candidate's own register; "reason" names the band criterion it serves.
- Do not rewrite the whole essay. Do not comment on handwriting, timing, or
  anything outside the text. Do not invent content the essay doesn't contain.
- If the essay is under the minimum length, say so plainly in a lengthNote
  and reflect it in TR per the descriptor.
Output JSON only, matching the provided schema exactly. No commentary.
```
