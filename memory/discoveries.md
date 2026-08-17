# Discoveries Log

Log Moderate/Major findings per the protocol in CLAUDE.md. Major findings need the
user to bring this file back to the planning session to update docs/plan.md.

Entry format:

## [Phase <N>] <short title> — Tier: <Moderate/Major>
**Finding:** what differs from the plan's assumption.
**Impact:** which phase(s) are affected, and how.
**How it was handled (if Moderate):** direction chosen + reasoning.
**Proposal (if Major):** concrete proposal for the planning model. Not self-implemented.
**Status:** unresolved / plan.md updated on <date>

---

## [Phase 00] Auth helpers live outside the locked file tree — Tier: Moderate
**Finding:** The Phase 00 file-tree contract specifies `src/lib/supabase/{client,server,admin}.ts`
but no home for auth *operations* (sign in, sign out, read current user). Putting
`supabase.auth.*` calls in `src/app/page.tsx` and `src/app/login/page.tsx` would
violate the CLAUDE.md invariant "data access goes through `src/lib/` modules, never
inline Supabase calls inside components".
**Impact:** Phase 1+ — any page needing the session should use these helpers rather
than re-deriving auth access. Additive only; nothing in the locked tree changed.
**How it was handled:** Added two modules.
- `src/lib/auth.ts` → `getCurrentUser(): Promise<User | null>`, server-side session read.
- `src/lib/auth-actions.ts` (`"use server"`) → `signInAction(prevState, formData)`
  returning `{ error: string | null }`, and `signOutAction()`.
Server actions rather than browser-client calls, so session cookies are written
server-side. `getCurrentUser` is kept out of the `"use server"` file so it isn't
exposed as a callable server-action endpoint.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 00] Migration applied via Management API, not SQL editor or CLI — Tier: Moderate
**Finding:** The task allowed applying `0001_init.sql` "via the Supabase SQL editor
or CLI". Neither was available to the execution session: the Supabase MCP server
returned `Unauthorized` on every call, and no `supabase`/`psql` binary is installed.
**Impact:** Phase 1 seeding is unaffected — the schema is live, verified, and empty.
The consequence is CLI-only: `supabase_migrations.schema_migrations` has no row for
`0001`, so a future `supabase db push` would try to re-apply the migration and fail
on "relation already exists".
**How it was handled:** Applied via `POST /v1/projects/{ref}/database/query` with a
user-supplied personal access token, then verified table list, RLS flags, policy
roles, and `select count(*) from units` = 0. The remediation
(`supabase migration repair --status applied 0001`) is documented in README §2.
An attempt to insert the history row directly was blocked by the session's
permission classifier.
**Status:** self-resolved. Follow-up for the user: rotate the pasted access token and
configure it as `SUPABASE_ACCESS_TOKEN` on the MCP server so Phase 1 has DB access.

---

## [Phase 01] Re-seeding vocab cascades away SRS progress — Tier: Moderate
**Finding:** The task specifies vocab idempotency as "delete+reinsert its
`vocab_words` (identified via `unit_id`) so re-running never duplicates".
`0001_init.sql` declares `vocab_cards.word_id ... references vocab_words(id) on
delete cascade`, so that delete also destroys every `vocab_cards` row built on
those words — i.e. all SRS scheduling (ease, interval, due date, reps, lapses)
for the re-seeded units. Today this is harmless (`vocab_cards` is empty and
Phase 3 has not shipped), but it becomes silent data loss the moment content is
re-seeded after SRS is in use — which is exactly what the 2-week seed-batch
cadence in `docs/plan.md` implies will happen routinely.
**Impact:** Phase 3 (vocab SRS) and every later content batch. Not an
architecture change: the schema and the idempotency contract are both fine in
isolation; they only interact badly.
**How it was handled:** Kept the specified delete+reinsert — changing the
idempotency strategy unilaterally would break the locked contract. Added a
pre-delete check in `scripts/seed.ts` that counts the `vocab_cards` rows about to
be cascaded and prints a `WARNING: re-seeding removes N vocab_cards row(s) (SRS
progress)` line before proceeding. The run is not aborted, because during
Phases 1–2 the count is always 0 and aborting would block legitimate re-seeds.
**Recommendation for Phase 3:** upsert `vocab_words` on a natural key
(`unit_id, word`) instead of delete+reinsert, so unchanged words keep their ids
and their cards. That is a Phase 3 decision, not a Phase 1 one.
**Status:** self-resolved for Phase 1, flagged for Phase 3. No plan.md change needed.

---

## [Phase 01] Seed script must load `.env.local` itself — Tier: Moderate
**Finding:** The task fixes the invocation as `npx tsx scripts/seed.ts <file>`,
with no Next.js runtime and no `--env-file` flag. Nothing populates `process.env`,
so `src/lib/config.ts` evaluates to empty strings and `createAdminClient()`
throws "SUPABASE_SERVICE_ROLE_KEY is not set".
**Impact:** Phase 1 only, but every later seed/CLI script inherits the pattern.
**How it was handled:** `scripts/seed.ts` calls `process.loadEnvFile('.env.local')`
(Node ≥20.12, this project runs 24.11) as its first statement, before the dynamic
`import()` of `src/lib/supabase/admin.ts`. The import must stay dynamic — a static
one would hoist and evaluate `config.ts` before the env file is loaded.
This does not violate the "only `config.ts` reads `process.env`" invariant: the
script *populates* the environment, it never reads a variable out of it. The
grep check still returns matches only in `config.ts`.
**Status:** self-resolved, no plan.md change needed. Phase 2+ scripts should copy
the same two-line preamble.
