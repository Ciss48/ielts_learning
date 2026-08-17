# Phase 01: Roadmap engine + session player

## Context Recap
IELTS Daily (see `docs/plan.md`) is a single-user IELTS self-study app. Phase 00
delivered the Next.js skeleton, the full Supabase schema (`0001_init.sql`), auth, and
route protection — see `memory/phase_00_report.md`. This phase builds the product's
core mechanic: a strictly sequential roadmap with a resume pointer, a daily session
player, and the first week of real content seeded from
`content/seed/week_01.json` (already authored by the architect — do not modify it).

## Goal
The daily habit loop works end-to-end: log in → Today screen shows the current unit →
open it → read the strategy lesson → mark complete → pointer advances → next login
resumes at the next unit, regardless of days skipped.

## Non-goals
- No test player, timers, or grading (Phase 2). Units with `test_id = null` simply
  have no Practice step yet.
- No vocabulary UI or SRS (Phase 3) — the seed script inserts `vocab_words` rows, but
  nothing displays them yet.
- No AI calls (Phase 4), no ingestion tool (Phase 5), no dashboard (Phase 6).
- No streak/heatmap display yet — but `completeUnit` MUST already write `study_log`.
- Do not invent, rewrite, or "improve" any content in `week_01.json`.

## Interface Contract

### `src/lib/roadmap.ts` (server-only module)
```ts
export type Block = 'diagnostic' | 'foundation' | 'skill_cycle' | 'mock' | 'taper';
export type Skill = 'reading' | 'listening' | 'writing' | 'speaking' | 'vocab' | 'mixed';

export interface Unit {
  id: string;
  seq: number;
  block: Block;
  skill: Skill;
  title: string;
  strategyMd: string;
  testId: string | null;
  estMinutes: number;
  elsaTask: string | null;
}

export type UnitStatus = 'done' | 'current' | 'locked';

/** Lowest seq with no unit_completions row; null when the roadmap is finished. */
export async function getCurrentUnit(): Promise<Unit | null>;

/** Fetch one unit by seq; null if it doesn't exist. */
export async function getUnitBySeq(seq: number): Promise<Unit | null>;

/**
 * Insert into unit_completions (idempotent — completing twice is a no-op) and
 * upsert study_log for today (Asia/Ho_Chi_Minh date): minutes += unit.estMinutes,
 * units_completed += 1 (only on first completion).
 * Returns the next uncompleted seq, or null if roadmap finished.
 */
export async function completeUnit(unitId: string): Promise<{ nextSeq: number | null }>;

/** All units ordered by seq with status. Exactly one unit is 'current'. */
export async function getRoadmap(): Promise<Array<Unit & { status: UnitStatus }>>;
```

### Routes
- `/` (Today): current unit card — skill badge, block label, title, `est_minutes`,
  ELSA task line if present — with one primary button "Start session" →
  `/unit/[seq]`. If roadmap finished: congratulatory empty state.
- `/unit/[seq]`: the session player. Guard: if `seq` > current seq → redirect to `/`
  (locked); if already completed → render read-only with a "Completed" badge and no
  complete button. Player steps for this phase: **Strategy** (render `strategy_md`
  as markdown) → **Complete** (server action calling `completeUnit`, then redirect
  to `/` which now shows the next unit).
- `/roadmap`: vertical list of all seeded units grouped by block, each row showing
  seq, skill badge, title, and status (done ✓ / current → / locked 🔒). Rows are
  links only when done or current.

### Seed script
- `scripts/seed.ts`, run as: `npx tsx scripts/seed.ts content/seed/week_01.json`
- Uses the service-role client (`src/lib/supabase/admin.ts`).
- **Idempotent by `seq`**: upsert units on the `seq` unique key; for each unit,
  delete+reinsert its `vocab_words` (identified via `unit_id`) so re-running never
  duplicates. Print a summary: `Seeded N units, M vocab words`.
- Seed JSON schema (matches `week_01.json` — validate before writing, abort with a
  clear error naming the bad field if invalid):
```json
{
  "units": [{
    "seq": 1,
    "block": "foundation",
    "skill": "mixed",
    "title": "...",
    "est_minutes": 60,
    "elsa_task": "..." ,
    "strategy_md": "...",
    "vocab": [{ "word": "...", "ipa": "...", "meaning_en": "...",
                "meaning_vi": "...", "example": "..." }]
  }]
}
```

### Markdown rendering
Use `react-markdown` (add dependency). No raw-HTML plugins.

### UI
Minimal clean Tailwind. If the user has placed a Claude Design export under
`design/`, use it as a visual reference for layout/spacing/colors; if `design/` is
absent, proceed with sensible minimal styling — do not block on it.

## Steps
1. Add `react-markdown`; implement `src/lib/roadmap.ts` per the contract.
2. Implement `scripts/seed.ts` with validation + idempotent upsert; run it against
   `content/seed/week_01.json`.
3. Build `/` (Today), `/unit/[seq]` (player with guard logic + complete server
   action), `/roadmap`.
4. Manually verify the pointer walk-through in Definition of Done.

## Definition of Done
- Seed: running `scripts/seed.ts` TWICE in a row ends with exactly 6 rows in `units`
  and 8 rows in `vocab_words` (counts verified via SQL).
- Fresh login shows unit seq 1 on `/`. Completing it and returning to `/` shows
  seq 2. Restarting the dev server and logging in again still shows seq 2.
- `/unit/5` while current unit is 2 redirects to `/`; `/unit/1` (completed) renders
  read-only with no complete button.
- Completing a unit creates today's `study_log` row with `units_completed = 1` and
  `minutes = est_minutes`; completing the same unit again via a replayed request does
  not change the counts.
- `/roadmap` shows exactly one 'current' unit; `npx tsc --noEmit` and
  `npm run build` pass; `process.env` still appears only in `src/lib/config.ts`.

## Handoff Obligations
1. Write `memory/phase_01_report.md`.
2. Overwrite `memory/STATE.md` (replace, don't append).
3. Log any Moderate/Major findings in `memory/discoveries.md`; STOP on Major.
