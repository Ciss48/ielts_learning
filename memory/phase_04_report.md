# Phase 04 report — vocabulary system (triage → SRS → heatmap) + Phase 03 carry-overs

**Executed:** 2026-08-17. Task file: `tasks/phase_04_vocab_srs.md`.

## Done

### Step 0 (a) — slash-separated answer keys

`scripts/lib/answer_variants.ts` (new, pure) holds the split judgement;
`scripts/ingest.ts`'s answer-attachment step calls it as pass 3, after the printed
keys have been attached and dereferenced, and reports every outcome in review.md.
The Phase 03 code that *warned* about an unsplit key is gone — it now splits, or says
in one sentence why it did not.

Not split (CLAUDE.md rule 3), each reported as a warning instead:
a key with no letters (`1/2`, `12/05/2023`); a variant that would break a bracket
pair (`(a/the) condenser` is one answer with an optional article); a variant past the
task's printed word limit, read from its own instruction line
("NO MORE THAN THREE WORDS" → 3); and an **unspaced slash between variants of
different lengths**, which is an elision rather than two standalone answers.
That last rule is the one that matters: splitting `South African tunneling/tunnelling`
naively yields `tunnelling`, which the source never prints alone, and would have
broken the very DoD item the split exists to fix. A *spaced* slash
(`two to five / 2-5`) is a typesetter separating whole alternatives and splits
regardless of length.

**On this source the pass split nothing, because there was nothing left to split** —
see the discovery below. The behaviour is verified by `scripts/check_split.ts`
(15 cases, all real printed keys from this PDF), not by this run.

Also tightened: the "several questions carry the same multi-answer key" warning now
fires for choice qtypes only. Since this change a `gap_fill` key legitimately holds
several entries, so fingerprinting them would raise a false multi-select alarm.

### Step 0 (b) — `scripts/enrich_explanations.ts` (text only)

One `textChat` call per question with an empty `explanation_md`, given the test's
transcribed passage, the question, its options and its **verified** key. The prompt
states the key is final and forbids disputing or revising it; a response that argues
with the key, or runs past 600 characters, is rejected rather than stored. No vision,
so it runs on the free OpenCode Zen text models.

Three guards, because this script edits a file the user is about to commit:
1. Before writing, re-serializing what was read must reproduce the file on disk byte
   for byte — otherwise it aborts, so "only `explanation_md` changed" is a claim
   about the *file*, not about a parsed object.
2. After the edits, the file with every explanation blanked must be byte-identical to
   the same projection of what was read. A mismatch aborts without writing.
3. An audit section is appended to `<base>.review.md` listing every explanation
   written and every skip, since review.md's own "Explained" column predates the run.

Run result: **11 explanations written, 0 skipped, 0 rejected** (p3 q1–3, p5 q1–4,
p7 q1–4 — the questions whose passage had been transcribed in a different chunk).
Independently diffed afterwards: the only fields that differ from the pre-run file
are 11 `explanation_md` values, plus `extracted_at` and the nine chunk *labels* in
`warnings`, both of which changed in the re-assembly, not the enrichment.

### Step 0 (c) — one re-commit

`npx tsx scripts/ingest.ts --from-logs` replayed the 10 cached text responses. The
`tests` block came back **byte-identical** to the previously staged file, so neither
the merge pass nor the new split pass moved any content.

**Slug stability verified before committing.** New `p1`–`p6` are the same six tasks
as the committed `p1`–`p6`, in the same order, with the same question numbers — and
after the commit all six `tests.id` values are unchanged, so the two existing
attempts are intact:

| slug | task | id unchanged |
| --- | --- | --- |
| `…-p1` | Matching Features (7–10) | `4446b34f…` |
| `…-p2` | Table Completion (9–13) | `19fa9e10…` |
| `…-p3` | Flow-chart Completion (1–3) | `6525c558…` |
| `…-p4` | Identifying Information: True/False/Not Given (1–3) | `3b034776…` |
| `…-p5` | Matching Headings (1–4) | `7d65d654…` |
| `…-p6` | Matching Sentence Endings (1–3) | `6ecc05d8…` |

**The four titles did drift, as the patch report warned.** The text path titles a task
by its printed running heading, so the six committed titles are now:

1. `Academic Reading Sample Task – Matching Features`
2. `Academic Reading Sample Task – Table Completion`
3. `Academic Reading Sample Task – Flow-chart Completion: selecting words from the text`
4. `Academic Reading Sample Task – Identifying Information: True/False/Not Given`
5. `Academic Reading Sample Task – Matching Headings`
6. `Academic Reading Sample Task – Matching Sentence Endings`

p3–p6 previously showed their passage titles ("How a caloric-restriction mimetic
works", "The life and work of Marie Curie", "The Physics of Traffic Behavior",
"Science in 16th-century London"). **Same tests, different display titles.** This was
listed in STATE.md as a decision waiting on the user; the Phase 04 kickoff instructed
the re-commit explicitly, so it went ahead — but it is a visible change and easy to
undo (a title is one `update`, or a re-commit from the cached vision logs).

**Two tests were deliberately not committed**, via a new `--skip=` flag rather than by
editing the staged file (which would destroy the extraction record):
- `…-p13` — five fabricated answer keys, admitted by the model's own warning and
  flagged by the patch's cross-check. Fidelity rule 5 skips diagram tasks.
- `…-p7` — the multi-select task the schema cannot represent; Phase 4b, and an
  explicit non-goal here.

Commit result: **6 updated, 5 inserted**. The bank is now 11 tests / 46 questions,
and **every question in the database has a non-empty `explanation_md`** (59 of 59,
including the 13 roadmap-embedded ones).

### Step 1 — `src/lib/srs.ts` + `scripts/check_srs.ts`

The four grade rules encoded verbatim, pure, no clock and no I/O. `MIN_EASE = 1.3`
and `MAX_INTERVAL_DAYS = 60` are named constants so the fixtures assert against the
rule rather than against a magic number. `scripts/check_srs.ts` pins all four grades
from a new card and from a card in circulation, both interval-0 starts, the ease floor
(approaching it and already at it), the 60-day cap on Good/Easy/Hard, a grade-0 lapse
after a 45-day interval, the bookkeeping invariants across every grade, that the input
is not mutated, and one seven-review card life.

### Step 2 — `src/lib/vocab.ts`, `src/lib/stats.ts`, `src/lib/day.ts`

Both contracts implemented as specified, plus three additions the pages needed:
`countDueCards()` (the due count without the warm-up cap), `getDeck()` (the `/vocab`
table) and `DEFAULT_DUE_LIMIT`.

`src/lib/day.ts` is new and is now the **one** definition of a calendar day in
Asia/Ho_Chi_Minh. `roadmap.ts` had the only copy of `todayInHoChiMinh`; it now
imports `today()` from here, and `labels.ts` takes the timezone constant from here
too. Day arithmetic runs on `YYYY-MM-DD` strings anchored to midnight UTC, so it
cannot be shifted by a local offset — which is the bug that would otherwise put a
card reviewed at 7am Vietnam time on the previous day.

`stats.ts` splits into an I/O half and a pure half (`buildHeatmap`, `computeStreak`,
`heatmapStart`) so the date logic is fixture-testable without waiting for the
calendar. Neither function touches anything but `study_log`.

### Step 3 — the player

Phase 02's `TestSession` (4 steps) and `PlainUnitPlayer` (2 steps) are replaced by one
`src/components/session/UnitSession.tsx`, because Phase 04 would otherwise have made
four players. The step list is data:

```
Warm-up → Strategy → [Practice → Review] → [Vocab] → Complete
```

- **Warm-up** exists only when `getDueCards()` is non-empty, so zero due cards means
  the step is absent, not empty. Capped at 20. "Skip warm-up" sits in the footer and
  jumps straight to Strategy. Each grade is persisted by `reviewCardAction` *before*
  the next card appears, so a mid-warm-up refresh loses nothing already answered.
- **Vocab** exists only when the unit teaches words. Every word shows in full with a
  checkbox that is **unchecked by default**; a word already in the deck renders
  checked and disabled with an "In your deck" pill. The footer's primary button reads
  "Add N words and continue" and sends only the newly ticked ids. A completed unit
  renders the list read-only.
- Practice/Review appear only for a unit with a test that is not yet complete — the
  Phase 02 behaviour, unchanged, including the timer, the auto-submit at 00:00 and the
  rule that the answer key only ever arrives in the submit response.
- `completeUnit` is untouched, and nothing in the vocabulary path writes `study_log`
  or `unit_completions` (grep-verified).

`src/components/session/VocabPanels.tsx` holds both panels; `/vocab` reuses
`WarmUpPanel` unchanged for "Review now", so a card graded in a session and a card
graded standalone are indistinguishable afterwards. **The bank player gets neither
step** — grep-verified: nothing under `src/app/bank/` or in `BankSession.tsx`
references the vocab library, the panels or the scheduler.

### Step 4 — Today page, `/vocab`, header

`src/components/StudyHeatmap.tsx` is 84 divs and one `color-mix`, built by hand from
the existing `--accent` / `--heat-0` tokens exactly as the design export computes the
ramp. **No chart library, no new dependency** — `package.json`'s only additions since
`main` are Phase 03's two R2 packages. Each cell carries a `title` naming its date and
minutes; empty days use the flat token and studied days one of three accent steps.
The streak sits beside it in the design's mono numeral.

`/vocab` shows total cards, due-today, "Review now" (capped, and it says so when the
backlog is bigger than the cap), and the deck as a table — word, meanings, due date,
interval, reps, lapses — due first. A "Vocabulary" tab was added to `AppHeader`
between Roadmap and Practice; middleware already covers the route.

## Verification

Definition of Done, item by item.

- **`npx tsx scripts/check_srs.ts` exits 0.** Also added: `npm run check` runs all
  four fixture suites (grading, SRS, answer-key split, heatmap/streak) — all pass.
- **Carry-over (a).** `p2` q13's committed key is
  `["South African tunneling", "South African tunnelling"]`; both spellings grade
  **correct** through the real `gradeAnswers`, and `tunnel` grades wrong. q11 accepts
  `two to five` and `2-5`. p1–p6 map to the same six tasks with the same ids
  (table above); the titles changed, and that is stated plainly rather than glossed.
  review.md logged **0 splits and 0 refusals**, because the patch had already left
  nothing to split — logged as a discovery, with the mechanism verified by fixture.
- **Carry-over (b).** 59 of 59 questions in the database have a non-empty
  `explanation_md`; the staged-file diff outside `explanation_md` is empty; the
  Review step already renders `explanationMd` (Phase 02's `ReviewPanel`, unchanged).
- **Triage.** `scripts/check_vocab_db.ts` against the live database: ticking 3 of unit
  2's 8 words creates exactly **3** `vocab_cards`; re-confirming the same 3 creates
  **0**; the deck grows by exactly 3; all three come back from the due query with
  their word joined. Run at the query layer, not through the page — see the open
  issue: no unit with vocabulary is reachable at the current pointer.
- **SRS flow, live.** A new card starts at ease 2.5 / interval 0 / due today. Good →
  due **tomorrow**, interval 1, ease unchanged, reps 1, and one `vocab_reviews` row
  recording grade 2. Then Again → lapses **1**, interval back to 1, due tomorrow,
  ease **2.3** (≥ the 1.3 floor), reps 2, two rows in the history, and the card has
  left today's due set. Every row the check created was deleted again; the deck is
  back to 0 cards, exactly as found.
- **Warm-up.** Step presence is decided by `warmUpCards.length > 0`, and `phase` is
  initialised to the first step — so with ≥1 due card `/unit/[seq]` opens on Warm-up
  and with 0 the step does not exist. Skip advances to Strategy. Verified by reading
  and by the build; **not** verified in a browser (see below).
- **Heatmap.** `scripts/check_stats.ts` pins the day arithmetic (month, year and leap
  boundaries), the range (12 weeks ending mid-week is 80 days; ending Sunday, 84;
  always starts on a Monday; never includes a future day), gap filling (a day with no
  row is an explicit zero, a row lands on its own date unshifted, a row outside the
  range does not leak in) and the streak (ending today, ending yesterday, broken by
  one whole day, longest-ever ignored, across a month boundary, future row ignored).
  It then **renders `StudyHeatmap` with `react-dom/server`** and asserts 80 cells in
  12 Monday-first columns, 77 flat `--heat-0` cells, 3 accent-mixed cells at the right
  two intensity steps, and per-cell tooltips naming the right date and minutes. The
  live `study_log` is empty, so the real page currently shows an all-zero grid and a
  streak of 0 — which is correct, and is what the empty-state caption says.
- **`npx tsc --noEmit`, `npm run lint`, `npm run build`** all clean; the route table
  shows `/vocab` alongside the seven earlier routes. `process.env` appears only in
  `src/lib/config.ts`. **No new dependency.**

### What is not verified

**The browser walk-through is still blocked, for a fourth phase.** The Chrome
extension cannot reach the dev server on `localhost:3000` or on the LAN IP (now
`192.168.1.144`, not `.11`): every navigation returns "Frame with ID 0 is showing
error page" and the dev server logs no request. `curl` from the same machine gets 200
and the expected 307 to `/login`, so the server is fine — the extension has no site
permission for it. Two attempts, then stopped.

So Phase 04's UI is verified one layer below the surface: the data operations against
the live database, the pure logic by fixture, the heatmap markup by server render, the
isolation properties by grep, and the whole tree by `tsc` and `next build`. What is
**not** proven is that the pages paint and the buttons wire up — same debt as
Phases 01–03, now covering: Warm-up appearing/skipping/grading in the player, the
Vocab checkboxes and the "Add N words" button, and the `/vocab` table and
"Review now".

## Decisions made

- **Grade 3 multiplies by the *raised* ease.** The locked rule reads
  `ease = ease + 0.15`, then `interval = round(interval * ease * 1.3)`; taken in the
  order written, the new ease applies. Encoded that way and pinned by a fixture
  (10 days at ease 2.5 → 34 days, not 32).
- **Ease is not rounded.** `2.5 - 0.2 + 0.15` is `2.4499999999999997` in binary
  floating point. The rules are encoded verbatim rather than "cleaned up", so a
  1e-16 drift is stored; it cannot move a rounded day count, and the one fixture that
  meets it compares within 1e-9.
- **Two players became one.** `UnitSession` replaces `TestSession` and
  `PlainUnitPlayer`; `TestSession.tsx` is deleted. `PracticePanels.tsx` — shared with
  the bank player — was not touched beyond a comment.
- **Warm-up is offered on a completed unit too**, if cards are due. A review schedule
  has nothing to do with which unit is open, and suppressing it there would mean a
  user browsing a past unit silently loses the chance to clear their deck.
- **`--skip` rather than editing the staged file**, so a "do not commit this one"
  decision is visible in the command and the report instead of being a deleted JSON
  entry.
- **The 3 test cards were cleaned up rather than left in the deck.** The deck should
  hold the user's choices, not the executor's fixtures, so `/vocab` is empty until
  they tick their first words.
- **Alphabetical ordering for a unit's word list.** `vocab_words` has no ordering
  column, so an order had to be chosen; alphabetical is stable across renders.

## New findings

Three Moderate discoveries, all logged in `memory/discoveries.md`, all self-resolved,
**no Major, no `docs/plan.md` change required**:

1. **The slash-split carry-over was already satisfied upstream**, so it split nothing
   on this source — and the printed keys that *do* contain slashes never reach
   `answer_key`. Fixture-verified instead of run-verified.
2. **Re-committing meant deciding what not to commit**, hence `--skip` on
   `ingest_commit.ts`.
3. **No unit teaching vocabulary is reachable at the current pointer** (units 2 and 12
   hold all 16 words; both are locked behind unit 1), so the Vocab step could not be
   exercised through the UI without completing units on the user's behalf.

## Open issues

1. **Four bank tests were renamed** by this commit (p3–p6). Deliberate, reversible,
   and stated above — but the user should confirm they are happy with task-type
   titles rather than passage titles.
2. **`…-p13` is still uncommitted** (fabricated keys) and **`…-p7` is still blocked**
   on the Phase 4b multi-select decision. Both remain staged, with warnings.
3. **The two `CLAUDE.md` files have drifted.** The project-root copy carries the AI
   provider rule, the `content/raw|staged` rule, the "AI-extracted content is never
   auto-inserted" rule and the Phase 04 normalization exception; the in-repo
   `ielts-daily/CLAUDE.md` has none of them. A future session reading only the
   in-repo copy would not know the rules it is bound by. Left for the user, since
   this is the file that governs the executor.
4. **Browser verification**, now four phases old. Granting the Chrome extension site
   permission for `http://localhost:3000` would let one future session clear the
   whole backlog.
5. **Phases 02, 03, the patch and now 04 are all uncommitted to git.** `main` is still
   at `068e763` (Phase 01).

## Input for next phase

- **`src/lib/srs.ts` is the schedule and it is pure.** Anything that needs to know
  when a card comes back should call `scheduleNext`, never re-derive it. The one place
  an interval becomes a date is `reviewCard` in `vocab.ts`.
- **`src/lib/day.ts` is the one definition of "today".** Any new feature dealing in
  calendar days (streaks, deadlines, daily quotas) must use it rather than
  `new Date()`, or it will disagree with `study_log` and `vocab_cards.due_date` by up
  to a day.
- **`study_log` remains the only progress ledger, written only by `completeUnit`.**
  Phase 04 deliberately does not write it from the vocabulary path; if a later phase
  wants "minutes spent reviewing", that is a schema decision, not a quiet addition.
- **`UnitSession` is where session steps go.** Adding a step means adding one entry to
  its `steps` array and one panel; both players' shared practice panels stay in
  `PracticePanels.tsx`. The bank player must stay a pure practice surface.
- **`npm run check` is the fixture gate** — grading, SRS, answer-key split,
  heatmap/streak. Extend it rather than adding an unreferenced script.
  `scripts/check_vocab_db.ts` is the live-database check and is safe to re-run: it
  never modifies a pre-existing card and cleans up after itself.
- **`scripts/enrich_explanations.ts` is a working pattern for Phase 05's text-only AI
  work**: one `textChat` call per item, a prompt that forbids revising verified
  content, a rejection filter on the response, and a byte-level diff guard before
  anything is saved. Phase 05's writing feedback draws on the same daily token pool.
- **The bank is 11 reading tests / 46 questions, all with explanations and verified
  keys**, addressable as `/bank/<slug>` and linkable from a unit with
  `"test_ref": "<slug>"`. p7 and p13 are not in it.
