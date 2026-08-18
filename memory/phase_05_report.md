# Phase 05 report — AI writing grading + explain-my-answer

**Executed:** 2026-08-17. Task file: `tasks/phase_05_writing_ai.md`.

## Done

### Step 1 — validator essay rules, top-level `tests[]`, the shared upsert

**`scripts/lib/bank_upsert.ts` is new and is the only place a bank test enters the
database.** Phase 03's id-stable slug upsert moved out of `ingest_commit.ts` verbatim —
look up by slug, UPDATE in place if it exists (so `tests.id`, and every `attempts` row
pointing at it, survives), INSERT otherwise, then replace the questions wholesale.
`ingest_commit.ts` and `seed.ts` both call it; neither owns a copy. `audioUrl: null`
means "leave whatever is stored alone", which is how re-committing without R2 keeps a
stored URL, and the previous URL comes back in the result so the committer can still
print it in its summary table.

**`parseSeedFile` now returns `{ units, tests }`.** A seed file may carry roadmap units,
a top-level `tests` array of hand-authored bank tests, or both; `writing_bank_01.json`
has only the second. Bank tests are written **first**, so a unit in the same file can
reference one by `test_ref`. A file with neither key is rejected naming `<root>`.

Validator rules added, all through the existing `ProblemSink` so a staged file warns
where a seed file aborts:

- **`essay` inverts the non-empty answer-key rule.** `answer_key` MUST be `[]` and
  `options` MUST be null; `explanation_md` stays optional. A stored key on an essay
  could only be a model answer pretending to be a key, and the grader would then mark a
  perfectly good essay wrong for not matching it.
- **A `writing` test is one task.** Exactly one question, and it must be an essay; its
  `content` needs `task_type` (`task1`/`task2`), a positive integer `min_words`, and a
  non-empty `prompt_md`.
- **A staged writing test is refused** (an addition, not in the task file — see
  Decisions). The ingestion shape has nowhere to put `task_type`/`min_words`/`prompt_md`,
  so a writing test extracted from a PDF could only reach the database with no task on
  it. Writing tests are authored in a seed file.

`content/seed/writing_bank_01.json` seeded as-is, **twice**. Second run: `0 inserted,
3 updated`, and a full snapshot of all three rows — ids, content, questions — diffed
byte-identical against the first run.

| slug | task | id |
| --- | --- | --- |
| `writing-t1-internet-vietnam` | Task 1, 150 words, 20 min | `f5b83f12…` |
| `writing-t2-social-media` | Task 2, 250 words, 40 min | `4d064500…` |
| `writing-t2-university-fees` | Task 2, 250 words, 40 min | `fbe923f1…` |

### Step 2 — `src/lib/writing.ts` + `src/lib/words.ts` + fixtures

`gradeEssay` is one `textChat` call against the Appendix rubric, reproduced **verbatim**
with only the mechanical parts filled in below it (task type, minimum length, measured
length, the task, the essay). Four properties it is built around:

1. **The overall band is computed in code and the model is never asked for one.** The
   prompt says so explicitly. `overallBand` is the mean of the four criteria snapped to
   the nearest half band, and a model-supplied `overallBand: 9` in the fixture is proven
   to be ignored.
2. **The response is validated, not trusted.** Four criteria in TR/CC/LR/GRA order or it
   is a shape error; every band snapped to 0.5 and clamped into [0, 9] on the way in, so
   nothing downstream ever sees 6.3 or 11; `topFixes` capped at 5, `improvedSentences` at
   3; and any `improvedSentences` entry whose `original` is not verbatim in the essay is
   **dropped**. A rewrite of a sentence the candidate never wrote is the most likely way
   this call goes wrong and the most damaging one.
3. **A shape or parse failure costs exactly one retry**, with the reason appended to the
   prompt, and then fails visibly. A provider failure is not retried here — `ai.ts`
   already did that three times.
4. **Under 50 words spends nothing.** The refusal is thrown before the request is even
   built.

`countWords` lives in **`src/lib/words.ts`** and is re-exported from `writing.ts`, so the
contract's surface is unchanged while the browser's live counter can import the rule
without dragging the AI client into the client bundle (verified: the rubric string does
not appear anywhere in `.next/static`). The rule is whitespace-split, and a token counts
if it contains a letter or digit — hyphenated compound is one word, number is one word,
a stray dash or bullet is not a word at all.

`scripts/check_writing.ts` (new, in `npm run check`) pins all of it **with the model
mocked** — `gradeEssay` takes an injectable `chat`, so no fixture touches a provider:
15 `countWords` cases, band snapping and the IELTS rounding of a .25 mean, every
validator rejection with its message, the verbatim-original filter, the caps, the
one-retry-then-give-up behaviour, the fenced/`<think>`-prefixed reply that needs no
retry, and the refusal at 49 vs 50 words asserting **zero** calls. It then renders
`EssayPanel`, `EssayRefusal` and `EssayFeedbackPanel` with `react-dom/server` and asserts
the markup: the Task 1 pipe table becomes a real `<table>` with every data cell, the
delimiter row does not leak, the word count reads `3 / 150 words` in `--faint` and turns
`--accent` at the minimum, and the feedback panel carries the band, the "AI estimate
±0.5" label, all four criteria and the length note.

### Step 3 — persistence and the player

`submitEssayAttempt` (in `src/lib/tests.ts`) stores `answers = {"essay": <verbatim>}`,
`submitted_at`, `band_estimate = overallBand`, `score_raw`/`score_total` **null**, and
`ai_feedback_md` — a markdown rendering of the whole feedback, so Phase 6 can show
history without re-parsing JSON. It refuses an already-submitted attempt (one grade per
attempt) and refuses under 50 words before the model call and before any write. It never
names `answer_key`, so Phase 02's "keys are read in exactly one function" is intact.

`src/components/session/WritingPanels.tsx` holds the three panels, and **both players use
them** — `UnitSession` and `BankSession` each branch on `test.essay !== null`. The panel
is the task on the left (sticky, markdown with tables), a plain textarea on the right
with `spellCheck` off (spelling is Lexical Resource), the live word count above it, the
existing countdown pill and the existing auto-submit at 00:00. `PlayerTest` gained one
additive field, `essay: PlayerEssay | null`; `questions` still carries objective
questions only, so every Phase 02/03 caller is unchanged. `getUnsupportedQTypes` no
longer reports `essay` on a writing test — it is supported now — but still reports one
sitting on a reading test, where nothing can render it.

`/bank` shows the Writing badge (`SkillBadge` already knew the skill) and the best-result
column shows `band 7.0` for a writing test instead of a score fraction.

### Step 4 — explain-my-answer

`src/lib/explain.ts` has **no UPDATE, INSERT or DELETE in it**. It re-reads the attempt,
the test's passage, the question, its options, the verified key and the stored
explanation from the database — the caller passes an attempt id and a qnum, never
content — re-grades the stored answer with the grader's own normalization and **refuses
if it was correct**, then makes one `textChat` call and returns the string. The prompt is
`enrich_explanations.ts`'s pattern plus "address THEIR answer: what made it tempting,
then what in the text rules it out", and it carries the same dispute filter, because a
model deciding the book is wrong would be far more damaging here, where the user is
already sure they were right.

The button renders inline in the shared `ReviewPanel`, on incorrect questions only, and
the result lives in component state and nowhere else. It says so: *"Generated just now
for this answer. It is not saved."*

## Verification

`scripts/check_writing_db.ts` (new, live, not in `npm run check` because it spends
tokens) mirrors the request-scoped library calls through the admin client — same
PostgREST calls in the same order — while driving the **real** `gradeEssay`, the **real**
`buildExplainPrompt` and the **real** rejection filter. It refuses to touch an attempt
that existed before it ran and deletes every row it creates. Definition of Done, item by
item:

- **`npm run check` green** — grading, SRS, answer-key split, heatmap/streak, writing.
- **Seeded twice, ids stable**, 3 writing tests / 3 essay questions, each with
  `answer_key: []` and `options: null`; `/bank` now lists 14 tests, 3 of them writing.
- **Live essay flow on `writing-t2-university-fees`.** A 286-word executor-written sample
  (test input, authorized by the task file) came back with exactly 4 criteria in order,
  every band a half step, `overallBand` equal to the code-computed mean, and every
  improved sentence verbatim from the essay. The attempts row carried
  `band_estimate = 7.0`, `ai_feedback_md` with all four criteria, `answers.essay`
  byte-identical to what was sent, and `score_raw IS NULL` / `score_total IS NULL`.
- **A 30-word submission is refused with ZERO AI calls** — instrumented: the injected
  chat increments a counter and the check asserts it is 0. The attempt stayed
  `submitted_at: null`, `band_estimate: null`, `ai_feedback_md: null`, `answers: {}`.
- **A 118-word Task 2 produced a non-null `lengthNote`** ("132 words short of the
  250-word minimum") and TR **4**, which is the descriptor being applied rather than
  quoted.
- **Explain-my-answer.** On a deliberately wrong answer (`B the Indians` against the key
  `A the Chinese`) it returned *"You chose 'the Indians' because the passage describes
  their advanced military rockets… The text explicitly states, 'Most historians of
  technology credit the Chinese with its discovery'"* — their answer, why it was
  tempting, and the verbatim quote that rules it out. **The full `attempts` row,
  snapshotted with `select *` before and after, is byte-identical.** The correct-answer
  guard was checked in both directions.
- **Objective grading untouched**, re-run at the library layer against the **live** unit 9
  data rather than a fixture copy: every stored key accepted, 13/13; nothing answered,
  0/13.
- **`npx tsc --noEmit`, `npm run lint`, `npm run build` all clean.** `process.env` appears
  only in `src/lib/config.ts`. **No new dependency** — `package.json`'s dependency list is
  unchanged.

### Rough token usage per graded essay

Measured on the live run, characters ÷ 4, so ±20%:

| call | in | out | total |
| --- | --- | --- | --- |
| **grade one 286-word Task 2 essay** | ~1,180 | ~920 | **~2,100** |
| explain one wrong answer | ~1,380 | ~130 | ~1,510 |

The grading prompt is ~1,000 tokens of fixed rubric plus the essay; a 250-word essay is
~330 tokens, so **essay length barely moves the total** — budget ~2,100 per graded essay
whatever the length. The explain call is dominated by the passage (a full reading passage
is ~1,200 of those 1,380 tokens), so it scales with the test, not the answer. For
comparison, Phase 03's ingestion spent thousands of tokens *per page*. **A full day of
writing practice — say three essays and five explanations — is ~14k tokens**, which is
comfortable even against the 200k/day Groq vision tier and invisible against the free
OpenCode Zen text models currently configured.

Wall clock: the graded essay took **26s** on `nemotron-3-ultra-free` (94s on a first,
slower run). The player shows "Grading…" for that whole time and has no streaming — worth
knowing before it feels broken.

### What is not verified

**The browser walk-through, for a fifth phase.** The Chrome extension still has no site
permission for `http://localhost:3000`. So Phase 05's UI is verified one layer down: the
model call and its validation by fixture with a mocked provider, the persistence and the
explain path against the live database, the **panel markup by server render**, the
bundle-isolation property by grep, and the whole tree by `tsc`, `lint` and `next build`.
What is not proven is that the pages paint and the buttons wire up — specifically: the
textarea accepting keystrokes and the counter updating live, the timer auto-submitting an
essay, the refusal banner appearing under the panel, and the explain button's
loading/error states.

## Decisions made

- **`countWords` moved to `src/lib/words.ts`** and is re-exported from `writing.ts`. The
  contract names it as part of `writing.ts`'s surface, but `writing.ts` is server-only,
  and the live counter needs it on every keystroke. One implementation, two import paths,
  and the rubric string provably absent from the client bundle.
- **The under-50-word refusal is enforced on both sides of the wire.** Next.js redacts
  server-action error messages in a production build, so a server-only refusal would
  reach the user as "An error occurred in the Server Components render". The client
  checks first and never sends the request; the server checks again and is authoritative.
  Both spend zero tokens, which is the property the task file asked for.
- **Markdown tables are rendered by hand** (`src/lib/md_tables.ts`). `react-markdown`
  needs `remark-gfm` for pipe tables and the DoD forbids a new dependency — and the Task 1
  prompt's table is not decoration, it is the question. The parser lifts a header +
  delimiter + body block out and hands everything else to `react-markdown` untouched.
  Escaped pipes are deliberately unsupported; no seed content uses one, and a
  half-working escape rule would be worse than none.
- **A staged writing test is refused by the validator.** Not in the task file. The
  ingestion shape has no field for `task_type`, `min_words` or `prompt_md`, so a writing
  test coming from a PDF could only reach the database with no task attached to it.
- **`getUnsupportedQTypes` learned which skill it is looking at**, so `essay` stops being
  reported as unsupported on a writing test while still being reported on a reading one.
- **One grade per attempt is enforced in the library**, not just by the UI: a second
  `submitEssayAttempt` on the same attempt is refused. "Trying again = a new attempt" is
  a non-goal made structural.
- **The sample essays live in `scripts/check_writing_db.ts`, not in a seed file.** They
  are executor-written test input, explicitly authorized; keeping them out of
  `content/seed/` keeps the "content is architect-authored" line where it belongs.

## New findings

Five Moderate discoveries, all logged in `memory/discoveries.md`, all self-resolved.
**No Major. No `docs/plan.md` change is required.**

1. A seed file may now legitimately contain no units, so `parseSeedFile`'s return type
   changed and the seeder's roadmap half is skipped for a bank-only file.
2. `remark-gfm` versus the no-new-dependency rule, with a Task 1 prompt that IS a table.
3. `countWords` had to leave the server-only module.
4. Server-action errors are redacted in production, so the refusal needs a client half.
5. The ingestion shape cannot carry a writing task, so staged writing tests are refused.

Two things that are not discoveries but that the user should read:

- **The grader is generous.** The 286-word sample essay — with `beleive` misspelled,
  `more fair` for `fairer`, and mechanical `Firstly/Secondly/Moreover` linking — came back
  at **7.0** (TR 7, CC 7, LR 6.5, GRA 6.5), despite a rubric that says in as many words
  not to inflate and that most intermediate essays sit between 5.0 and 6.5. The criterion
  comments are accurate and specific — they catch every one of those errors — but the
  numbers attached to them run about a band high. **This is exactly why the overall band
  is labelled "AI estimate ±0.5"**, and it is worth treating the comments and the top
  fixes as the product and the number as decoration.
- **`content/seed/week_03_04.json` (units 13–24) has never been seeded**, and I found that
  out the hard way: re-seeding all three files to prove the refactored seeder had not
  regressed inserted 12 units and 16 vocabulary words that were not there before. That was
  outside this phase's scope, so **I reverted it** — the units and their words were deleted
  after confirming no attempt, completion or SRS card hung off them, and the database is
  back to `units=12`, `vocab_words=16`. `week_01` and `week_02` re-seeded idempotently and
  were left alone. If weeks 3–4 are meant to be live, it is one command:
  `npx tsx scripts/seed.ts content/seed/week_03_04.json`.

## Open issues

1. **Browser verification**, now five phases old. Granting the Chrome extension site
   permission for `http://localhost:3000` would let one session clear the whole backlog.
2. **Weeks 3–4 are authored but not seeded** — see above. The user's call.
3. **Grading takes 26–94 seconds** with no streaming and no progress beyond a "Grading…"
   button. Acceptable for a personal tool; worth a spinner or a streamed response if it
   starts to feel broken.
4. **The four carried-over Phase 04 items are untouched**: the renamed bank tests to
   confirm, `…-p13` (fabricated keys) and `…-p7` (multi-select) still staged and
   uncommitted, and the two drifted `CLAUDE.md` files.
5. **Phases 02–05 are still uncommitted to git.** `main` is at Phase 01.

## Input for next phase

- **`src/lib/writing.ts` is the model call and the validation; nothing else grades an
  essay.** `overallBand` is computed there and only there — never store or display a
  model-supplied average, and never re-derive the mean somewhere else.
- **`attempts.ai_feedback_md` is the display format.** Phase 6's history view should
  render that markdown, not re-parse feedback JSON; that is why it exists. `score_raw IS
  NULL AND band_estimate IS NOT NULL` is how you tell an essay attempt from an objective
  one, and `unit_id IS NULL` still separates bank practice from roadmap.
- **`scripts/lib/bank_upsert.ts` is the only way a bank test enters the database.** A
  third writer must call it rather than re-implement the slug lookup, or attempts start
  getting orphaned.
- **`src/lib/words.ts` is the one word-counting rule**, and `MIN_ESSAY_WORDS` lives beside
  it because the browser needs both.
- **`npm run check` is still the fixture gate** — grading, SRS, split, heatmap, writing.
  `scripts/check_writing_db.ts` and `scripts/check_vocab_db.ts` are the live checks; both
  are safe to re-run and both clean up after themselves, but the writing one **spends
  ~5.7k tokens** per run (two essays plus one explanation).
- **`explain.ts` writes nothing, and that is a property to preserve.** If a later phase
  wants to keep an explanation, it needs a table and a decision, not an `update` added to
  that module.
- **The bank is 14 tests**: 11 reading (46 questions) and 3 writing (3 essays), plus the
  roadmap-embedded reading test. `writing-t2-university-fees` is the one with a live
  attempt history behind it (deleted after the check, so the count is back to 2).
