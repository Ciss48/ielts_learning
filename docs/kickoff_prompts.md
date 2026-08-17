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

Respect the Non-goals section strictly (no test player, no vocab UI, no AI). When
every Definition of Done item passes, fulfill the Handoff Obligations (phase report
+ overwrite STATE.md) and stop.
```
