# Phase 02 report — Test player + timer + objective grading

**Date:** 2026-08-17
**Status:** Code complete. Every Definition-of-Done item verified except the two
that need an authenticated browser session (timer auto-submit, and the HTTP-level
HTML grep). Both are covered at the layer below; see Open issues §1.

---

## Done

**Migration `0002_vocab_word_key.sql`**
- Written verbatim from the task. **Applied by the user in the Supabase SQL
  editor** (project `gmmdnbsxrlojzhseaffj`). The Supabase MCP server was not
  usable — see New findings §1.
- Verified live: the `onConflict: 'unit_id,word'` upsert now succeeds, where it
  previously failed with `there is no unique or exclusion constraint matching the
  ON CONFLICT specification`.

**`scripts/seed.ts`**
- **Vocab natural-key upsert.** `upsert(..., { onConflict: 'unit_id,word' })`,
  then a prune pass that deletes only the words a unit no longer carries.
  Unchanged words keep their ids, so `vocab_cards` survive — the Phase 01
  discovery is now actually fixed, not just warned about.
- The cascade warning was **kept but rescoped**: it now fires only for the stale
  words actually being deleted, naming the unit and the `vocab_cards` count.
- **Tests + questions.** New `test` block on a unit, validated with the same
  abort-naming-the-field discipline: `skill`/`title`/`duration_minutes`/
  `audio_url`/`content`/`questions`, `answer_key` required as a non-empty string
  array, `qnum` a positive integer and unique per test.
- **Id-stable test upsert.** `units.test_id` null → insert the test and link it;
  non-null → UPDATE that row in place. Questions are deleted and reinserted. A
  `tests` row is never deleted, so `attempts` history is never orphaned.
- Also added: **duplicate `word` within one unit is now rejected** at validation
  time. Without the check the new upsert would fail mid-run with a Postgres
  "cannot affect row a second time" error instead of a field path.
- Keeps Phase 01's `.env.local` self-loading preamble and dynamic admin import.

**`src/lib/band.ts`** — both Academic tables encoded verbatim as descending
`[min, band]` rows; `rawToBand` returns null unless `total === 40`.

**`src/lib/tests.ts`** — the locked contract implemented verbatim
(`ObjectiveQType`, `PlayerQuestion`, `PlayerTest`, `PerQuestionResult`,
`GradedAttempt`, `getTestForUnit`, `startAttempt`, `submitAttempt`,
`gradeAnswers`). The module's organising principle: `answer_key` and
`explanation_md` are named in exactly one select, inside `submitAttempt`.

**`scripts/check_grading.ts`** — 52 assertions, no DB and no environment needed.

**Player at `/unit/[seq]`** — four-step rail Strategy → Practice → Review →
Complete for units with a `testId`; Phase 01's two-step rail for everything else.
Practice intro (title / question count / duration / Begin), the design export's
split view, the sticky countdown pill with auto-submit at 00:00, server-graded
Review with per-question state, the user's answer, accepted answers and
`explanation_md` via `react-markdown`, then Complete → the **unchanged**
`completeUnitAction`, still called exactly once.

## Definition of Done — verification

| Item | Result |
| --- | --- |
| `npx tsx scripts/check_grading.ts` exits 0 | ✅ 52 assertions pass |
| Seed twice → `units=12, tests=1, questions=13, vocab_words=16` | ✅ identical after both runs |
| SRS survival proof | ✅ card `1824…` on word `c981…` ("alleviate") survived the re-seed with the same `word_id` and same card id; test row deleted afterwards (`vocab_cards=0`) |
| Id stability proof | ✅ unit 9 `test_id` = `43997c2c-a7ca-4be2-8f22-8fa082f253db` before and after the second seed; `questions` still 13 |
| All-13-correct → `13/13`, band null | ✅ against the **real seeded answer keys** |
| All-blank → `scoreRaw=0`, 13 per-question results | ✅ all `given: ""`, all incorrect |
| No `answer_key` / `explanation_md` pre-submission | ✅ see below — verified at the payload layer, not over HTTP |
| Timer auto-submit at 00:00 | ⚠️ **not verified by me** — needs a browser session |
| `attempts` row with `submitted_at`, `answers`, `score_raw=13`, `score_total=13` | ✅ row `db2af08e…` persisted; `answers` jsonb round-trips byte-identical |
| `npx tsc --noEmit`, `npm run build`, `npm run lint` | ✅ all clean |
| `process.env` only in `src/lib/config.ts` | ✅ 8 matches in `config.ts`; the 2 in `seed.ts` are comments |

**How the answer-key check was actually done.** The DoD asks for a grep of the
served HTML for `Despommier popularized`. That needs an authenticated request,
which this session could not make (Open issues §1), so it was verified one layer
down, where the property actually lives:
1. `PlayerTest` is the only test data that crosses to the client. Running the
   *exact* selects `getTestForUnit` issues and serialising the result gives 5908
   bytes containing **neither** the canary string, **nor** `answer_key`, **nor**
   `explanation`.
2. The same query with the answer-key columns added **does** contain the canary —
   so the canary is a live probe, not a string that happens to be absent.
3. `grep -rn "answer_key\|explanation_md" src/` returns exactly one select:
   `src/lib/tests.ts:283`, inside `submitAttempt`.
Since the page can only render what is in `PlayerTest`, HTML that contained the
canary pre-submission would require one of those three facts to be false.

## New findings

1. **The Supabase MCP server points at the wrong project, and its token is
   rejected.** `~/.claude.json`'s global `mcpServers.supabase` is pinned to
   project-ref `oodcylqxwqicdeargogz`; IELTS Daily is `gmmdnbsxrlojzhseaffj`. Every
   MCP call also returns `Unauthorized`. So even a token fix alone would have
   applied migrations to the wrong database. Tier: **Moderate**, logged in
   `discoveries.md`. The user applied 0002 via the SQL editor instead.
2. **`~/.claude.json` holds four Supabase MCP entries carrying three distinct
   personal access tokens in plaintext — all three are Expired.** (Corrected
   after checking them against the Supabase dashboard; an earlier draft of this
   report called them four live tokens, which overstated the risk.) They are dead
   config, not live credentials. The habit-tracker token `sbp_8984…` does appear
   in two entries pointing at two different project refs (the global one and
   `Diary_ver2`), so the reuse observation stands — it is just moot now.
   The user does follow a per-project token discipline; this was one slip.
   Tier: Minor (environment, not app code).
   **The one live token is `sbp_601a…` (`ielts_learning`, expires 2026-09-15).**
   It is *not* in `~/.claude.json`. Its last-used timestamp lines up with Phase
   00's Management API migration, so it is almost certainly the token pasted into
   the Phase 00 chat — i.e. Phase 00's original rotation item is about this token
   and this one only. See Open issues §3.
3. **`content/seed/week_02.json` is well-formed.** 6 units (seq 7–12, all
   `foundation`), unit 9 carries the 13-question reading test (5 tfng, 4 gap_fill,
   4 mcq, 20 min), unit 12 carries 8 vocab words. Seeded unchanged; nothing was
   edited, reformatted or added.
4. **Every choice question's `answer_key` matches one of its `options` exactly**
   under the normalization rule — checked programmatically across all 13
   questions, 0 mismatches. This is what makes the "submit the option string
   verbatim" rule safe, and it is worth re-running for future content batches.
5. **The Chrome extension still cannot reach `localhost`** (nor `127.0.0.1`) —
   Chrome renders an error page, while `curl` reaches the same server fine.
   Unchanged from Phase 01. Tier: Minor, verification tooling only.

## Decisions made

- **Countdown is anchored to the client clock, not `started_at`.** The deadline
  is `Date.now() + durationMinutes*60_000`, captured when Begin returns. Using the
  server's `started_at` would hand the user a 0-second or double-length test
  whenever the browser clock is skewed. `started_at` remains authoritative on the
  `attempts` row.
- **`getUnsupportedQTypes` is additive rather than a field on `PlayerTest`.** The
  contract types `PlayerTest.questions` as `ObjectiveQType`, so an `essay` row
  cannot live there, but the player still has to warn about it. Widening the
  locked return type was the alternative; a separate exported function keeps
  `getTestForUnit`'s signature verbatim. Essay questions are filtered out of
  `questions` and the Practice intro shows a "not yet supported" notice.
- **`gradeAnswers` trims `given` for display.** The spec pins only the empty case;
  whitespace-only is treated as unanswered. The `attempts.answers` jsonb still
  stores exactly what was submitted.
- **Choice inputs are radios carrying the option string**, with letter labels
  shown only for `mcq`/`matching` — "A) TRUE" reads badly, and the labels are
  visual-only anyway.
- **The questions panel scrolls inside its sticky container**
  (`lg:max-h-[calc(100vh-118px)] lg:overflow-y-auto`). The design's sticky aside
  was drawn for 6 short matching questions; 13 questions with 4-option MCQs would
  otherwise run past the viewport and strand the Submit button.
- **The step rail moved to `src/components/session/StepRail.tsx`** and both
  players now use it at `max-w-[1180px]` (the design export's container width;
  Phase 01 had the rail inline at 1080px). Unifying avoided two rails that drift.
- **A completed test unit renders the plain read-only view**, omitting Practice —
  explicitly allowed by the task.
- **New `--warn` design token** (light + dark) for timer urgency and incorrect
  answers. Reusing `--sk-speaking` would have tied a state colour to the skill
  axis. Also added `.prose-passage` and `.prose-explanation` to `globals.css`.
- **No mid-test resume, no `beforeunload` guard.** Non-goal; a refresh restarts
  the attempt and the Practice intro says so.
- **A unit that drops its `test` from the seed file keeps its `test_id`.**
  Unlinking would be a content decision, and the task forbids deleting `tests`.

## Open issues

1. **Two DoD items need an authenticated browser session, which this session
   could not obtain** — the same blocker Phase 01 hit, for the same two reasons
   (session-minting is correctly blocked by the permission classifier; the Chrome
   extension has no `localhost` site permission). Both were re-tested, not assumed.
   To finish them yourself — `npx next dev -p 3111`, log in, go to `/unit/9`:
   1. **Timer auto-submit.** `update tests set duration_minutes = 1;` then Begin,
      wait for 00:00, confirm it submits itself and lands on Review. Restore with
      `update tests set duration_minutes = 20;`.
   2. **HTML grep.** With the Practice step open *before* submitting, view source
      and search for `Despommier popularized` — it must be absent, then present
      after submitting.
2. **Phase 01's walk-through is still unverified** and now extends through
   Phase 02's steps. Units 1–8 have no test, unit 9 does, so the natural check is:
   `/` → Unit 01 → complete → … → Unit 09 shows the four-step rail.
   Nothing in the DB blocks it: `unit_completions=0`, `study_log=0`, pointer at
   unit 1.
3. **Fix the Supabase MCP wiring** — this is the only outstanding item that
   blocks Phase 03.
   - Rotate `sbp_601a…` (`ielts_learning`) because it was pasted into the Phase
     00 chat, not because of `~/.claude.json` — it was never stored there.
   - Delete the top-level `mcpServers.supabase` entry in `~/.claude.json`. Its
     token is expired *and* it is pinned to `oodcylqxwqicdeargogz`; because this
     project had no entry of its own it fell through to that one, which is why
     every MCP call failed. The three `projects/` entries are expired too but
     only affect their own projects — leave them.
   - `/Users/vudung/Desktop/Project/ielts_learning/.mcp.json` (written in Phase
     02) pins `--project-ref gmmdnbsxrlojzhseaffj` and carries no token; the
     server inherits `SUPABASE_ACCESS_TOKEN` from the launching shell.
   - **Verify by connection, not by absence of error:** run `list_tables` and
     confirm the 9 IELTS tables come back. "No longer Unauthorized" is not proof
     the right database is attached.
4. **Disable public signups** — still outstanding from Phase 00, and still means
   anyone who can create an account gets full read/write via `authenticated_all`.
5. **`supabase migration repair --status applied 0001`** before any future
   `supabase db push` — and now `0002` needs the same treatment, since it was also
   applied outside the CLI.
6. **Phase 02 is not committed yet.** Correction to Phases 00/01's reports, which
   both claimed nothing was committed: `main` already carries `7f75721`
   (Phase 00) and `068e763` (Phase 01). Only Phase 02's changes are outstanding.
   `.env.local` is ignored via `.gitignore:34` (`.env*`) and is not tracked.
7. **`config.ts` still says `anthropicApiKey` / `ANTHROPIC_API_KEY`** while
   `.env.local` carries `GROK_API_KEY`. Root `CLAUDE.md` assigns the rename to
   Phase 3, the first phase that calls the API. Untouched, as before.

## Input for next phase (Phase 03 — ingestion)

- **The seed contract now covers `tests` + `questions`.** Ingestion output should
  land in `content/staged/` in the same per-unit shape (`test.questions[]` with
  `answer_key` as a string array) so the existing validator can consume it after
  the user confirms. Do not write AI-extracted answer keys straight to the DB.
- **`tests` ids are stable across re-seeds and must stay that way** — `attempts`
  reference them. If ingestion ever needs to replace a test, update it in place.
- **`vocab_words` now upsert on `(unit_id, word)`**, so SRS progress survives
  re-seeding. Phase 3 can rely on this; the Phase 01 hazard is closed. Changing a
  word's spelling still creates a new row and drops the old card — that is the
  one remaining edge.
- **`getTestForUnit` is the client-safe read; `submitAttempt` is the only place
  answer keys are read.** Keep that split. If Phase 5 adds essay support, it needs
  a new path — `PlayerQuestion.qtype` is deliberately `ObjectiveQType`.
- **`rawToBand` returns null below a 40-question paper.** Mock tests in the later
  blocks are the first content that will produce a real band; nothing needs to
  change for that to start working.
- **Listening is implemented but untested** — `<audio controls>` renders above the
  questions when `audioUrl` is set, and `content.transcript_md` is parsed but
  never rendered (during Practice it would be the answers). No listening content
  exists yet; Phase 3 is where this gets exercised for real.
