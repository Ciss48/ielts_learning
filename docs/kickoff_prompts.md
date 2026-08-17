# Kickoff prompts for Claude Code

Each phase runs in a FRESH Claude Code session inside the `ielts-daily/` project
root. Paste the matching prompt verbatim. Run Phase 01 only after Phase 00's output
has been reviewed by the planning session.

---

## Phase 00 kickoff (paste into Claude Code)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — it contains mandatory invariant rules and
   the discovery protocol. Follow it exactly.
2. Read memory/STATE.md for current project state.
3. Read tasks/phase_00_scaffold_schema.md — this is your task. The SQL schema and
   file contracts in it are locked decisions: implement them verbatim, do not
   redesign them.

Context: this is a fresh repo containing only planning docs (CLAUDE.md, docs/,
tasks/, memory/, content/). Build Phase 00 exactly as specified: Next.js 15 +
TypeScript strict + Tailwind scaffold, Supabase schema migration, single-user auth
with middleware route protection. My Supabase project already exists; I will fill
.env.local myself from your .env.example — never ask me to paste keys into chat.

Respect the Non-goals section strictly. When every Definition of Done item passes,
fulfill the Handoff Obligations (phase report + overwrite STATE.md) and stop.
```

---

## Phase 01 kickoff (paste into a NEW Claude Code session after Phase 00 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md and memory/phase_00_report.md for what already exists.
3. Read tasks/phase_01_roadmap_engine.md — this is your task. The TypeScript
   interface contract in it is locked: implement those exact signatures.

Build the roadmap engine (sequential pointer over units.seq), the Today screen, the
session player with completion, the /roadmap overview, and the idempotent seed
script. Seed content/seed/week_01.json — that file is architect-owned data: seed it
as-is, never edit or "improve" its content. If it seems malformed, log a discovery
instead of fixing content yourself.

---

## Phase 02 kickoff (paste into a NEW Claude Code session after Phase 01 review)

```
You are the execution model for the IELTS Daily project. Before writing any code:

1. Read CLAUDE.md in the project root — mandatory rules and discovery protocol.
2. Read memory/STATE.md, memory/phase_01_report.md (especially its "Input for
   next phase" section), and the [Phase 01] entries in memory/discoveries.md.
3. Read tasks/phase_02_test_player.md — this is your task. The migration SQL,
   the tests.ts / band.ts signatures, and the grading normalization rules in it
   are locked: implement them verbatim.

Build the Practice step of the session player: migration 0002 (vocab natural-key
upsert fix), seed script support for tests/questions with id-stable upserts, the
timed test player with the design export's split view and countdown pill,
server-side grading (answer keys and explanations must never reach the client
before submission), attempt persistence, and the review screen. Then seed
content/seed/week_02.json — architect-owned data: seed as-is, never edit or
"improve" it; log a discovery if it seems malformed.

Reuse Phase 01's patterns: the .env.local self-loading preamble for scripts, the
existing completeUnitAction (called exactly once, at the final step), and the
design tokens already in globals.css. Respect the Non-goals strictly (no essay
rendering, no vocab UI, no AI, no ingestion, no mid-test resume). When every
Definition of Done item passes, fulfill the Handoff Obligations and stop.
```
