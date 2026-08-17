# State

**Last updated:** 2026-08-17 — Phase 01 executed

## Where things stand
Phase 01 (roadmap engine + session player) is **code complete**. The engine, the
seed script, and all three routes are built, typecheck, lint and build clean, and
the database-level behaviour is verified against the real Supabase project.

One Definition-of-Done item is **not** verified: the authenticated click-through
(`/` → start → complete → pointer advances). This session had no way to obtain a
login session — see "Blocking / user actions" #1. Everything it depends on is
verified at the layer below it.

Current phase: **02 — test player**. Status: not started. Do not start it until
the walk-through in #1 passes.

## Completed
- **Phase 00** — see `memory/phase_00_report.md`. Scaffold, schema, auth, route
  protection.
- **Phase 01** — see `memory/phase_01_report.md`.
  - `src/lib/roadmap.ts` — the locked contract, verbatim signatures.
    Pointer is derived (lowest `seq` with no `unit_completions` row), never stored.
  - `scripts/seed.ts` — validating, idempotent, refuses to insert new units behind
    the completed pointer. `npm run seed <file>` or
    `npx tsx scripts/seed.ts content/seed/week_01.json`.
  - Routes `/` (Today), `/unit/[seq]` (Strategy → Complete, guarded),
    `/roadmap` (grouped by block). `/login` restyled onto the design tokens.
  - Design tokens from `design/IELTS Daily.dc.html` ported into `globals.css`
    with a light/dark toggle. `react-markdown` added for `strategy_md`.
  - Verified: seed run twice → `units=6`, `vocab_words=8` ✅; completion
    idempotency + `study_log` arithmetic (45 min, 1 unit, unchanged on replay) ✅;
    pointer advance 1 → 2 ✅; `npx tsc --noEmit` ✅; `npm run build` ✅;
    `npm run lint` ✅; `process.env` only in `config.ts` ✅.
  - Database left pristine after verification: `unit_completions=0`, `study_log=0`.

## Most important findings so far
- Locked stack: Next.js 15 + TS strict + Tailwind 4, Supabase (single user),
  Cloudflare R2 from Phase 2. **AI provider is Grok, not Anthropic** (root
  CLAUDE.md, 2026-08-16) — `config.ts` still says `anthropicApiKey`; the rename to
  `grokApiKey` / `GROK_API_KEY` is Phase 4's job and was deliberately not done now.
- `content/seed/week_01.json` is well-formed: 6 units (seq 1–6, all `foundation`),
  8 vocab words all attached to unit 2. Seeded unchanged.
- **Re-seeding wipes SRS progress** — `vocab_cards.word_id` cascades on delete, so
  the specified vocab delete+reinsert destroys review scheduling. Harmless today,
  a real hazard from Phase 3. Logged in `discoveries.md` with a recommended fix.
- Four Moderate discoveries logged in total (two from Phase 00, two from Phase 01),
  all self-resolved. **No Major discoveries. No `docs/plan.md` change is needed.**
- The single Supabase user exists and is confirmed — Phase 00's open item #3 is
  done. Disabling public signups is still not.

## Blocking / user actions outstanding
1. **Run the Phase 01 walk-through** (the one unverified DoD item). Dev server:
   `npx next dev -p 3111`, log in as `dungvutien48@gmail.com`, then:
   `/` shows Unit 01 (45 min) → *Start session* → markdown lesson →
   *Mark complete* → `/` now shows Unit 02 (60 min) → `/unit/5` bounces to `/` →
   `/unit/1` is read-only with a "Completed" badge → restart the server, `/` still
   shows Unit 02.
   Two attempts to do this automatically failed and were **not** worked around:
   session-minting was blocked by the permission classifier, and the Chrome
   extension has no site permission for `localhost`. Granting either one lets the
   next session finish the verification.
2. **Disable public signups** (Supabase → Authentication → Sign In / Providers →
   Email). Until then, the `authenticated_all` RLS policy means anyone who can
   create an account gets full read/write on every table.
3. **Rotate the Supabase personal access token** pasted into the Phase 00 chat.
4. Before any future `supabase db push`: run
   `supabase migration repair --status applied 0001` (README §2).
5. Nothing is committed to git — still a staged, uncommitted tree.

## Next action
Confirm item #1 passes. Then read `tasks/phase_02_*.md` and
`memory/phase_01_report.md` § "Input for next phase" before starting Phase 02.
