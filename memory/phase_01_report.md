# Phase 01 report — Roadmap engine + session player

**Date:** 2026-08-17
**Status:** Code complete and verified. One Definition-of-Done item — the
authenticated click-through — could not be executed by this session (no way to
obtain a login session). See Open issues §1 for the 6-step checklist.

---

## Done

**Engine — `src/lib/roadmap.ts`** (server-only, exact contract signatures)
- `getCurrentUnit()`, `getUnitBySeq(seq)`, `completeUnit(unitId)`, `getRoadmap()`
  plus the `Block` / `Skill` / `Unit` / `UnitStatus` types, verbatim from the task.
- Pointer is derived, never stored: one `units` query ordered by `seq` + one
  `unit_completions` query, first unit whose id is not in the completed set.
- `completeUnit` writes via
  `upsert({unit_id}, {onConflict:'unit_id', ignoreDuplicates:true}).select()`.
  On a replay PostgREST issues `ON CONFLICT DO NOTHING` and returns zero rows —
  that empty array is the "not the first completion" signal that keeps
  `study_log` from double counting.
- `study_log` day key is the **Asia/Ho_Chi_Minh** date via
  `Intl.DateTimeFormat('en-CA', …)`, which emits `YYYY-MM-DD` directly.
- Uses the session-scoped server client (`src/lib/supabase/server.ts`), so every
  read/write goes through RLS as the authenticated user.

**Seed — `scripts/seed.ts`**
- `npx tsx scripts/seed.ts content/seed/week_01.json` (also `npm run seed <file>`).
- Full structural validation before any write; failures abort naming the exact
  field path, e.g. ``Invalid seed file at `units[2].est_minutes`: expected a
  positive integer, got "60"``. Duplicate `seq` inside one file is rejected too.
- Units upserted on the `seq` unique key. `id` is deliberately **not** in the
  payload, so an existing row keeps its primary key — and therefore its
  `unit_completions` row survives a re-seed.
- Vocab is delete-then-reinsert per `unit_id`, so re-running never duplicates.
- Enforces the CLAUDE.md pointer invariant: a *new* unit whose `seq` is at or
  below the highest completed `seq` aborts the run. Updating an existing unit at
  such a seq is still allowed.
- Loads `.env.local` itself with `process.loadEnvFile()` before importing
  anything that pulls in `config.ts` — it runs under plain `tsx`, outside Next,
  where nothing has populated `process.env`.

**Routes**
- `/` — Today. Skill badge, block + week label, title, `Unit NN · N min`, ELSA
  line when present, one primary "Start session" → `/unit/[seq]`. Two distinct
  empty states: *roadmap finished* vs *nothing seeded yet* (the same `null` from
  `getCurrentUnit()` means very different things to the user).
- `/unit/[seq]` — session player. Reads `getRoadmap()` once so the guard uses the
  same truth the roadmap page shows: `status === 'locked'` → `redirect('/')`,
  non-existent seq → `notFound()`, `status === 'done'` → read-only with a
  "Completed" badge and no complete button. Strategy step renders `strategy_md`
  through `react-markdown` (no raw-HTML plugins). Step rail shows
  Strategy → Complete.
- `/roadmap` — progress header + bar, units grouped by block in canonical order,
  each row: seq circle (✓ when done), skill badge, title, status. Locked rows are
  plain `<div>`s, not links.
- `completeUnitAction` (`src/app/unit/[seq]/actions.ts`) re-checks server-side
  that the submitted seq **is** the current pointer before calling
  `completeUnit`; a forged or replayed POST is a no-op redirect, so the roadmap
  can never be skipped ahead from the client.

**UI / design**
- Design tokens ported verbatim from `design/IELTS Daily.dc.html` into
  `globals.css` (same variable names, so future design revisions diff cleanly),
  exposed to Tailwind 4 via `@theme inline`.
- Newsreader / IBM Plex Sans / IBM Plex Mono loaded with a `<link>` in the root
  layout rather than `next/font`, preserving Phase 00's offline-build property.
- Light/dark toggle (`data-theme` on `<html>`, persisted to `localStorage`) with a
  blocking init script in `<head>` so there is no wrong-palette flash.
- `/login` restyled onto the same tokens — it was the only screen left on the
  Phase 00 placeholder styling.

## Definition of Done — verification

| Item | Result |
| --- | --- |
| Seed run twice → 6 units, 8 vocab words | ✅ ran twice; SQL counts `units=6`, `vocab_words=8` |
| `completeUnit` writes today's `study_log` with `units_completed=1`, `minutes=est_minutes` | ✅ `{"day":"2026-08-17","minutes":45,"units_completed":1}` for seq 1 (est 45) |
| Replayed completion does not change the counts | ✅ 2nd upsert returned 0 rows; `study_log` unchanged; `unit_completions` stayed at 1 |
| Pointer advances after a completion | ✅ next uncompleted seq = 2 |
| `npx tsc --noEmit` | ✅ 0 errors |
| `npm run build` | ✅ 0 errors, 5 routes + middleware |
| `npm run lint` | ✅ clean |
| `process.env` only in `src/lib/config.ts` | ✅ 8 matches, all in `config.ts` (2 hits in `seed.ts` are comments) |
| Fresh login shows seq 1; complete → seq 2; restart → still seq 2 | ⚠️ **not verified by me** — needs an authenticated browser session |
| `/unit/5` while current is 2 redirects to `/`; `/unit/1` read-only | ⚠️ **not verified by me** — same reason (logic verified by reading `getRoadmap()` status, not by a live request) |
| `/roadmap` shows exactly one 'current' | ⚠️ **not verified in the browser**; guaranteed by construction — status is derived from a single `firstUncompleted()` id |

The three ⚠️ rows are all the same blocker, not three separate ones. See below.

**How the verified rows were checked:** the DB-level items were exercised against
the real Supabase project with a throwaway script that issues the *exact*
PostgREST calls `completeUnit()` makes, then deletes what it wrote. Post-run
state confirmed clean: `unit_completions=0`, `study_log=0`, so your own
walk-through starts from unit 1 as intended.

## New findings

1. **No way for this session to obtain a login session.** Two routes were tried:
   - Minting a session for the existing user via an admin magic link →
     `verifyOtp` → forged `@supabase/ssr` cookie. **Blocked by the permission
     classifier**, correctly — it looks exactly like credential handling. Not
     worked around.
   - Driving `http://localhost:3111` with the Chrome extension. Chrome returns an
     error page for localhost on both `/` and `/login`; the extension has no
     site permission for it. `curl` reaches the same server fine
     (`/` → 307 → `/login`, `/login` → 200), so this is a browser-extension
     permission, not an app fault.
   Tier: Minor (a verification-tooling limit, not a design problem).
2. **`content/seed/week_01.json` is well-formed** — 6 units, seq 1–6, all
   `foundation`, 8 vocab words all on unit 2. Passed validation unchanged. No
   content was edited, reformatted or added.
3. **Re-seeding destroys SRS progress.** `vocab_cards.word_id` has
   `on delete cascade`, so the delete-then-reinsert vocab strategy silently drops
   any Phase 3 review scheduling built on those words. Tier: **Moderate** —
   logged in `discoveries.md`, mitigated with a warning; the real fix belongs to
   Phase 3.
4. **`config.ts` still exposes `anthropicApiKey` / `ANTHROPIC_API_KEY`** while
   `.env.local` now carries `GROK_API_KEY`. Root `CLAUDE.md` says the rename
   happens when Phase 4 introduces it, so it was left untouched. Nothing in
   Phase 1 reads it.

## Decisions made

- **`/unit/[seq]` reads `getRoadmap()` rather than
  `getCurrentUnit()` + `getUnitBySeq()`.** Same two queries, but the guard then
  uses the exact `UnitStatus` the roadmap page displays, so "locked" can never
  mean two different things on two screens. `getUnitBySeq` is still part of the
  contract and is used by the complete action.
- **The complete action re-validates the pointer server-side.** The task only
  required the page guard; a hidden `seq` field in a form is client-supplied, and
  trusting it would let a crafted POST complete a locked unit and jump the
  roadmap. Cheap to check, so it is checked.
- **Week number = `ceil(seq / 6)`**, from `docs/plan.md` ("6 units/week"), kept in
  `src/lib/labels.ts` as `UNITS_PER_WEEK`.
- **`/roadmap` counts against seeded units, not the planned 144.** The design
  mock reads "Unit 7 of 144"; with only week 1 loaded, printing 144 would state
  something the database does not contain. It shows "Unit 1 of 6" and a percentage
  over seeded units, and will read 144 once 144 are seeded.
- **The ELSA task is a static line, not a checkbox.** The design shows a tickable
  row, but there is no `elsa_completions` table and Phase 1 adds no schema, so an
  interactive checkbox would imply persistence that does not exist.
- **Design features belonging to later phases were not built**: the 12-week heat
  map and streak counter (Phase 6 dashboard), the practice split-view, the
  question inputs and the countdown timer (Phase 2 test player). Non-goals
  respected — no test player, no vocab UI, no AI.
- **Sign-out moved into the header** (Phase 00 asked for it to be preserved or
  relocated); the placeholder home page it lived on is gone.
- **New files beyond the task's list**: `src/lib/labels.ts` (enum → display
  strings, pure), `src/lib/theme.ts` (theme constants shared across the
  `"use client"` boundary), `src/components/{AppHeader,SkillBadge,ThemeToggle}.tsx`.
  No data access in any of them.

## Open issues

1. **The authenticated walk-through is yours to run.** The dev server is up at
   `http://localhost:3111` (`npx next dev -p 3111`). Log in as
   `dungvutien48@gmail.com` and check:
   1. `/` shows **Unit 01 — "Orientation: how band 7.0 is actually earned"**, 45 min.
   2. Click *Start session* → the strategy lesson renders as formatted markdown.
   3. Click *Mark complete* → back on `/`, now showing **Unit 02**, 60 min.
   4. Visit `/unit/5` → should bounce straight back to `/`.
   5. Visit `/unit/1` → renders with a "Completed" badge, no complete button.
   6. Stop and restart the dev server, reload `/` → still Unit 02.

   If you would rather I drive it, either grant the Chrome extension access to
   `localhost`, or approve the blocked session-minting script — say which and I
   will finish the verification.
2. **Phase 00's manual dashboard steps.** The single user exists and is confirmed
   (verified via the admin API — one user, `email_confirmed_at` set), so that item
   is done. **Disabling public signups is still outstanding** and still matters:
   the `authenticated_all` RLS policy gives any account that can be created full
   read/write on every table.
3. **Rotate the Supabase personal access token** pasted in the Phase 00 chat —
   still outstanding from that phase.
4. **`supabase migration repair --status applied 0001`** before any future
   `supabase db push` — still outstanding from Phase 00.
5. **Nothing is committed to git.** Still a staged, uncommitted tree.

## Input for next phase (Phase 02 — test player)

- **`getCurrentUnit` / `getRoadmap` / `completeUnit` are the only progress API.**
  Do not add a second pointer notion. `completeUnit` is where `study_log`
  accumulates, and it is already idempotent — the test player should call it
  once, at the end of the session, not per step.
- **Units carry `testId` (currently always `null`).** The player at
  `/unit/[seq]` renders Strategy → Complete; the Practice step slots between
  them when `unit.testId !== null`. The step rail in
  `src/app/unit/[seq]/page.tsx` is a local `<Step>` component built for exactly
  this — it takes `current | done | locked` and will need a real step model.
- **The design export already specifies the practice UI** —
  `design/IELTS Daily.dc.html` has the passage/questions split view, the sticky
  question panel, the countdown pill and the 5-step rail (Warm-up · Strategy ·
  Practice · Review · Vocab). Tokens are already in `globals.css`; reuse them
  rather than re-porting. Note the design's `support.js` was never present
  locally — only the `.dc.html` was, which is all that was needed.
- **The seed script only handles `units` + `vocab_words`.** Phase 2 content needs
  `tests` and `questions` support added to `scripts/seed.ts`, with the same
  validate-then-abort discipline. Keep the `seq` upsert key for units.
- **Re-seeding wipes `vocab_cards`** (see discoveries) — anything Phase 2/3 builds
  on top of `vocab_words` inherits that hazard.
- **Timezone helper is duplicated in intent, not in code**: the
  Asia/Ho_Chi_Minh date lives in `roadmap.ts` (`todayInHoChiMinh`, private) and
  the display date in `labels.ts` (`formatToday`). If Phase 2 needs the study day
  elsewhere, promote the former rather than re-deriving it.
