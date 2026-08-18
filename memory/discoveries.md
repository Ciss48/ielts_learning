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

---

## [Phase 02] Supabase MCP server points at a different project — Tier: Moderate
**Finding:** The task allows applying migration `0002` "via Supabase MCP if the
rotated token is configured". Two independent problems blocked that. First, every
MCP call returns `Unauthorized` — the token configured for the server is rejected
(unchanged since Phase 00). Second, and more seriously, the global
`mcpServers.supabase` entry in `~/.claude.json` is pinned to
`--project-ref oodcylqxwqicdeargogz`, while IELTS Daily is `gmmdnbsxrlojzhseaffj`.
Supplying a valid token *without* also fixing the ref would have applied the
migration to an unrelated project.
**Impact:** Every phase that needs DDL. Phase 03 (ingestion) is the next one.
**Root cause (confirmed against the Supabase dashboard):** `ielts_learning` has no
MCP entry of its own in `~/.claude.json`, so it fell through to the top-level
`mcpServers.supabase` — which carries the *habit tracker* token (expired) pinned to
the *habit tracker* project ref. Wrong credential and wrong database at once.
On the plaintext concern: `~/.claude.json` has 4 entries carrying 3 distinct
tokens, and **all 3 are Expired** — dead config, not live credentials. An earlier
draft of this entry called them four live tokens; that overstated it. The user does
issue one token per project. The single live token, `sbp_601a…`
(`ielts_learning`, expires 2026-09-15), is not in that file at all; its last-used
time matches Phase 00's Management API call, so Phase 00's "rotate the pasted
token" item refers to this token specifically.
**How it was handled:** Surfaced both facts to the user before acting, rather than
"fixing" the token and silently migrating the wrong database. The user applied
`0002` in the Supabase SQL editor for the correct project; the constraint was then
confirmed live by the previously-failing `onConflict: 'unit_id,word'` upsert
succeeding. No token was pasted into chat and none was used by this session.
**Recommendation:** rotate `sbp_601a…` only (it was exposed in the Phase 00 chat);
the rest are already expired and need nothing. Delete the top-level
`mcpServers.supabase` entry — it is the fall-through that caused this. Phase 02
added `.mcp.json` at the working-directory root pinning
`--project-ref gmmdnbsxrlojzhseaffj` with no token in it; the server inherits
`SUPABASE_ACCESS_TOKEN` from the launching shell, so the token lives in one place.
**Verify by connection, not by absence of error:** `list_tables` must return the 9
IELTS tables. Note that `0002`, like `0001`, is not
recorded in `supabase_migrations.schema_migrations`, so it needs the same
`supabase migration repair --status applied 0002` before any future `db push`.
**Status:** self-resolved for Phase 2. Follow-ups outstanding for the user.

---

## [Phase 02] Duplicate words in one unit break the new vocab upsert — Tier: Moderate
**Finding:** Switching vocab to `upsert(..., { onConflict: 'unit_id,word' })`
introduced a failure mode the old delete-then-reinsert did not have: if a seed
file lists the same `word` twice under one unit, Postgres aborts the whole
statement with `ON CONFLICT DO UPDATE command cannot affect row a second time`.
That is a raw Postgres error naming no field, which violates the seeder's
abort-naming-the-exact-field contract.
**Impact:** Phase 02 onward, and specifically any hand-authored or AI-extracted
content batch (Phase 03 stages vocab from ingestion, where duplicates are likely).
**How it was handled:** Added a per-unit duplicate-word check to `parseSeedFile`,
alongside the existing duplicate-`seq` check, so the run aborts before any write
with e.g. ``Invalid seed file at `units[5].vocab[3].word`: duplicate word "yield"
in this unit, already used by units[5].vocab[1]``. The equivalent check was added
for duplicate `qnum` within a test, which has the same unique-constraint shape.
`week_01.json` and `week_02.json` both pass unchanged.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 03] The provider's real limits make the ≤5-page chunk contract impossible — Tier: Moderate
**Finding:** The task file locks the vision pass at "≤5 pages/call — this matches the
current Groq vision model's 5-image-per-request limit". Both halves of that are wrong
for the live provider, and they fail in two different ways:
1. `qwen/qwen3.6-27b` rejects more than **3** images:
   `Too many images provided. This model supports up to 3 images`.
2. The binding constraint is not images but tokens. The free (`on_demand`) tier
   allows **8,000 tokens per minute**, and Groq admits a request against
   `input + max_completion_tokens`, not against actual usage. A 3-page request was
   rejected with `Requested 21962` — 5,578 of input plus the 16,384 output
   reservation. So the output cap has to be budgeted like input, and at 150 DPI
   (~2.4k tokens/page) only **one** page fits per call.
**Impact:** Phase 03's extraction step, and Phase 05, which reuses `src/lib/ai.ts`
for writing feedback and will meet the same 8k/minute window.
**How it was handled:** The pipeline is unchanged in shape; the constants moved to
where the truth is.
- `MAX_IMAGES_PER_CALL = 3` in `ai.ts` (the provider's real ceiling, and a safe
  default for an unknown OpenAI-compatible gateway).
- `MAX_COMPLETION_TOKENS = 4096`, documented as a rate-limit budget item rather than
  a safety cap, since an over-generous value makes every request fail rather than
  merely cost more.
- `MAX_PAGES_PER_CHUNK = 1` in `ingest.ts`, with the arithmetic in the comment so a
  paid tier can raise it. Nothing else depends on the chunk size — fragments are
  stitched by the merge pass either way.
- `reasoning_effort: "none"`, which removes the `<think>` block this model otherwise
  emits before its JSON. That reclaimed most of the output budget. It is sent
  optimistically and disabled for the rest of the process if a provider rejects it
  (400 mentioning the field), so `ai.ts` stays provider-agnostic.
- `ai.ts` self-throttles: it reads `x-ratelimit-remaining-tokens` /
  `x-ratelimit-reset-tokens` and holds the next request when the window is nearly
  spent, and honours `retry-after`. Groq reports a TPM overrun as **413 with
  `code: rate_limit_exceeded`**, not 429, so retryability is decided by the body,
  not the status alone.
**Cost of the workaround:** a 46-page PDF is 46 sequential calls paced by the token
window — roughly 40 minutes. Correct, but slow; a paid tier would collapse it.
**Status:** self-resolved. No plan.md change needed — the contract's intent (respect
the provider's limit, never exceed it) is honoured; only the numbers were wrong.

---

## [Phase 03] One page per call splits every question from its printed answer key — Tier: Moderate
**Finding:** A direct consequence of the discovery above, and the one that actually
threatened the Definition of Done. This source (`ielts-academic-reading-sample-tasks-2023.pdf`)
prints each task's answer key on its **own page**, immediately after the questions —
the per-task layout the Appendix prompt explicitly anticipates. With one page per
vision call, the questions page and the answers page are never in the same request.
The model behaved exactly as instructed: it emitted `"answer_key": []` plus
`Answer key not visible on these pages` rather than guessing (fidelity rule 2). The
result was a staged file in which *every* key was empty — which the hard validator
correctly refuses to commit. Fidelity rule 2 held; the DoD could not be met.
**Impact:** Phase 03 only. It would equally affect the far more common
"answers in one section at the back of the book" layout, which no fixed-size page
window can ever pair with the questions.
**How it was handled:** Added an answers channel to the per-chunk output schema —
a mechanical adaptation of the kind the Appendix permits, and one that makes
fidelity rule 2 *achievable* rather than weakening it:
- A page that prints answers is returned as `answer_pages[]`
  (`for_title` + `{qnum, answer}[]`) instead of as a fragment.
- After the merge pass groups fragments into tests, `assemble()` matches answer
  pages to tests by their printed heading and fills in each question's key by
  question number.
- **Label dereferencing.** An answers page often prints only a label (`7  A`) while
  the options page prints label plus text (`A  the Chinese`). Since hard rule 1 now
  requires a choice key to be one of `options`, the printed cross-reference has to be
  followed. `resolveAnswer()` does this mechanically: exact option match first, then
  match on the printed label. If no option carries that label the printed answer is
  kept verbatim and the hard validator will reject it at commit. Every substitution
  is recorded as a warning naming both sides, so it appears in review.md for the
  user to check before anything is committed. The vision prompt was also tightened
  to keep each option's printed label in the option string — required by fidelity
  rule 1 ("keep paragraph labels like A/B/C") but something the model dropped.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 03] The merge pass returns a plan, not merged text — Tier: Moderate
**Finding:** The task file specifies "one text pass to merge chunks into the staged
schema". Taken literally — feeding the transcribed fragments to the model and having
it emit the merged staged JSON — that pass would re-generate every passage and every
question prompt through an LLM. This directly contradicts fidelity rule 1
(TRANSCRIBE, never paraphrase), and on a 46-page document it would also exceed both
the output cap and the token window.
**Impact:** Phase 03. Anything later that re-processes staged content should follow
the same rule.
**How it was handled:** The merge pass receives only *metadata* — fragment ids,
titles, task types, question counts, and 160-character head/tail excerpts used to
detect a passage running across a page break — and returns a grouping plan
(`{fragment_ids, title, skill}[]`). `ingest.ts` then performs the concatenation in
code, so transcribed text reaches the staged file byte-for-byte as the vision pass
produced it and cannot be silently reworded. The pass still exists and still does
the judgement work the task file wanted from it; it just does not touch the prose.
If it fails or returns unparseable JSON, the fallback stages each fragment as its
own test plus a warning, rather than losing the extraction.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 03] The free tier's 200k tokens/day cap bounds how much content can be ingested — Tier: Moderate
**Finding:** Separate from, and more consequential than, the per-minute limit: the
Groq `on_demand` tier also enforces **200,000 tokens per day** for this model.
A 46-page PDF costs roughly 190k tokens to transcribe at one 150-DPI page per call
(~4.1k admitted per page), so **one 46-page source very nearly exhausts an entire
day's budget** — this run reached page 28 of 46 and stopped at 199,568/200,000.
The refusal arrives as `429 … on tokens per day (TPD)` with a `retry-after` of up to
~48 minutes, and the daily window refills slowly rather than all at once.
**Impact:**
- Phase 03: throughput is capped at roughly 45–50 pages of source material per day
  on the free tier, regardless of how the pipeline is written. Ingesting a full
  Cambridge book (3 passages × several tests) will take multiple days or a paid tier.
- **Phase 05** is the one to watch. Writing feedback reuses `src/lib/ai.ts`, and an
  essay-feedback call is far cheaper than a page transcription, but it draws on the
  *same* daily pool. Ingesting content and drafting essay feedback on the same day
  will contend. Phase 05 should not assume the budget is free.
**How it was handled:** Nothing in the code can raise a provider quota, so the work
went into making the limit cheap to live with rather than fatal:
- **`--resume`.** Each chunk's raw response is already logged verbatim, so a run
  interrupted at page 28 replays those 28 pages from disk in seconds and calls the
  API only for what is genuinely missing. An interruption now costs nothing.
- **Waits are capped** (`MAX_WAIT_MS = 90s`) and an over-budget request fails with
  the delay the provider asked for. Before this, honouring a 1,728s `retry-after`
  verbatim made the CLI sit silent for 32 minutes, which is indistinguishable from a
  hang — the failure mode that actually cost this phase the most time.
- **A request timeout** (`AbortSignal.timeout`, 180s), which was missing entirely.
- **`--from-logs`** re-assembles a staged file from cached responses, so iterating on
  grouping/answer-attachment logic costs one cheap merge call instead of a full
  re-transcription.
- **`--no-merge`** groups fragments by printed title with zero API calls, for when
  even the merge pass will not fit. It is a fallback, not a default: measured against
  the merge pass on this source it is clearly worse (title-only grouping strands a
  passage whose page carries a different heading), so it should not be used for
  content that will be committed.
**Recommendation for the user:** the provider-agnostic design is the escape hatch —
`AI_BASE_URL` / `AI_MODEL` / `AI_API_KEY` point anywhere OpenAI-compatible. Either a
Groq Dev Tier upgrade or another endpoint removes the ceiling without a code change.
**Status:** self-resolved as far as code can resolve it. The remaining 18 pages of
`ielts-academic-reading-sample-tasks-2023.pdf` are outstanding, pending quota — the
user chose to commit the 28-page subset now and finish the rest later.

---

## [Phase 03 patch] The merge pass ignores its own `continues_previous` rule — Tier: Moderate
**Finding:** With 5-page TEXT chunks a task frequently straddles a chunk boundary
and is transcribed as two fragments: one carrying the questions *and their
options*, one carrying the passage plus an option-less second copy of the same
questions. The transcription pass correctly marks the second fragment
`continues_previous: true`, and the merge prompt's very first rule says such a
fragment belongs to the same test as the one before it — but the merge pass is an
LLM call, and it emitted the two halves as two separate tests. Neither half is
committable (one has no passage, the other has bare-label keys), and because slugs
are positional the extra test **shifted every slug after it**, so the newly staged
`p6` was a different task from the committed `p6`. That is exactly the silent
slug-drift failure Phase 03's open issue 2 warned about, reached by a route nobody
predicted.
**Impact:** Any source whose tasks do not align to chunk boundaries, i.e. all of
them. It is a staging-correctness and slug-identity problem, not an architecture
one.
**How it was handled:** The rule is now enforced in code rather than requested of a
model. `joinContinuations` (`scripts/ingest.ts`) folds a fragment marked
`continues_previous` back into the test holding the fragment before it, and reports
every join in `review.md`. The guard is **strict printed-title equality**, because
the failure Phase 03 feared — the flag staying true straight across a genuine task
boundary and fusing unrelated tasks — always presents as two different printed
titles. Question numbers deliberately do *not* guard the join: a re-transcribed
task repeats its own numbers, and `assemble` already de-duplicates by qnum keeping
the first copy, which is the one that came with its options. Five joins occurred in
the final 46-page run, after which the 13 staged tests match the source's own
contents page one-for-one and `p1`–`p6` map to the same six committed tasks.
Separately, slug indices are now assigned only to tests that actually reach the
staged file — an entry with no questions used to consume an index and leave a hole.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 03 patch] A model-filled answer key bypassed the printed-label dereference — Tier: Moderate
**Finding:** Phase 03 ran one page per call, so questions and their printed answer
key were never in the same request and every key arrived empty — which meant
`attachAnswers` filled all of them and dereferenced every printed label ("A" →
"A the Chinese") on the way in. A 5-page TEXT chunk holds a task *and* its answers
page, so the model now fills `answer_key` itself, and `attachAnswers` — which only
ever touched empty keys — never ran. `…-p1` came out keyed `"A"` while its options
read `"A the Chinese"`: every correct answer would grade wrong, and the hard
validator would reject the commit outright.
**Impact:** Every choice question (mcq/tfng/ynng/matching) on the TEXT path.
**How it was handled:** A pass 0 in `attachAnswers` applies the existing
`resolveAnswer` to keys that arrived with the question, exactly as it already did
for keys it filled from an answers page — the same mechanical label lookup, never
invention, with every substitution reported. 23 substitutions in the final run, and
the staged file now passes hard validation.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 03 patch] Seeing the passage lets the model invent answer keys — Tier: Moderate
**Finding:** The flip side of a chunk large enough to hold a whole task: with the
passage in front of it, the model sometimes answers *from the passage* instead of
copying the printed key — fidelity rule 2's exact prohibition. Observed twice:
`…-p13` (Diagram Label Completion) had all five keys invented, with the model's own
warning admitting it ("Answer key ... not found in provided pages; answers inferred
from passage text"), and on one assembly `…-p3` q3 was padded from the printed
`preservation` to `preservation of the organism` — which also breaks the task's
printed "NO MORE THAN TWO WORDS" limit. Nothing in the pipeline checked, because
until now a filled key could only have come from a printed answers page.
**Impact:** Any TEXT-path extraction. Silent wrong answer keys are the worst
possible failure for this project — they would grade a correct answer wrong, and
the staged file still passes structural validation.
**How it was handled:** The printed answers page is still extracted separately, so
`apply` now cross-checks an already-filled key against it and **reports every
disagreement** rather than trusting either side, naming both values and stating
that the printed key is the authority. Keys are not silently overwritten — that
would be an executor making a content decision. A key transcribed as the
slash-split of the printed key (`["two to five", "2-5"]` for a printed
`two to five / 2-5`) is recognised as fidelity rule 4 working correctly and is not
reported as drift. The check caught all five p13 fabrications and the p3 q3
padding.
**Status:** self-resolved, no plan.md change needed. **The user must still read
`review.md` and drop `…-p13` before committing.**

---

## [Phase 04] The slash-split carry-over was already satisfied upstream, so it split nothing — Tier: Moderate
**Finding:** Carry-over (a) exists because Phase 03 refused to split a printed key
of the form `X/Y`, leaving `p2` q11 keyed `["two to five / 2-5"]` — a correct answer
that graded wrong. The Phase 04 task file grants explicit architect authorization to
split, and the Definition of Done asks for "review.md logged the splits". Both were
written *before* the Phase 03 patch ran. The patch's 5-page TEXT chunks put each task
and its printed answers page in the same request, so the transcription pass now emits
one entry per printed variant by itself: the re-assembled file has **zero** answer
keys containing a slash, and the split pass therefore performed **zero** splits.
The end state the carry-over wanted was already reached by a different route.
Worse for exercising the path: the printed keys in this source that *do* contain
slashes are all on page 46 (the Diagram Label task's answers), and they never reach
`answer_key` at all, because `attachAnswers` only fills keys that arrived empty and
the model had already filled those in-chunk.
**Impact:** Phase 04's DoD wording only. No later phase; the mechanism is needed for
any future source whose chunks *don't* hold a task and its answers together — a
scanned book on the vision path, or the far more common "answers at the back"
layout, where every key still arrives from a separate answers page.
**How it was handled:** The split was implemented anyway and made provably correct
rather than provably exercised.
- The judgement moved to `scripts/lib/answer_variants.ts` (pure) so it could be
  fixture-tested: `scripts/ingest.ts` runs a pipeline on import and cannot be
  imported by a check script.
- `scripts/check_split.ts` pins 15 cases, using the real printed keys from this
  source — including the three from page 46 that a naive split would corrupt.
- The heuristic implements CLAUDE.md's rule 3 ("do not split when the slash is part
  of the printed answer") with four refusal conditions, each reported in review.md:
  no letters in the key (`1/2`, `12/05/2023`), an unbalanced bracket
  (`(a/the) condenser` is one answer with an optional article), a variant past the
  task's printed word limit, and — the one that took the most thought — an
  **unspaced slash between variants of different lengths**. `pure/distilled water`
  and `South African tunneling/tunnelling` are elisions where the shorter side
  borrows words from the longer one; splitting them naively yields `tunnelling`,
  which the source never prints as a standalone answer, and would have *broken* the
  very DoD item (both spellings of q13 grading correct) that the split was meant to
  fix. A spaced slash (`two to five / 2-5`) is a typesetter separating whole
  alternatives and splits regardless of length.
- Related tightening: the "same multi-answer key on several questions" warning now
  fires only for choice qtypes. A gap_fill key legitimately holds several entries
  since this change, so fingerprinting them would raise a false multi-select alarm.
**Status:** self-resolved, no plan.md change needed. The reported outcome is "0
splits, 0 refusals on this source"; the behaviour is verified by fixture, not by
this source.

---

## [Phase 04] Re-committing meant deciding what NOT to commit, so the committer gained `--skip` — Tier: Moderate
**Finding:** Step 0 says to re-commit the source after the two carry-overs, but two
of the 13 staged tests must not enter the database, and both reasons are content
rules rather than bugs:
- `…-p13` (Diagram Label Completion) has **five fabricated answer keys**. The
  extraction model's own warning admits inferring them from the passage, the Phase 03
  patch's cross-check flags all five against the printed page-46 key, and fidelity
  rule 5 says diagram tasks are skipped outright. Committing invented answer keys is
  precisely what CLAUDE.md's content rule forbids.
- `…-p7` ("choose TWO letters … IN EITHER ORDER") cannot be represented: one printed
  key covers a pair of questions jointly, so each question would separately accept
  either letter and answering `B` twice would score 2/2. Multi-select is an explicit
  Phase 4b non-goal.
The only way to leave them out was to delete them from the staged JSON — which
destroys the record of what was extracted, and is a content edit an executor should
not make silently.
**Impact:** `scripts/ingest_commit.ts`, and every future commit from a staged file
that contains one task the user has decided against. That is the normal case, not
an exception.
**How it was handled:** `ingest_commit.ts` takes `--skip=<slug>,<slug>`. The named
tests stay in the staged file and in review.md, are still hard-validated, and are
simply not written; the console prints one line per skip, and the summary reads
"Committing 11 of 13". An unknown slug aborts before any write, so a typo cannot
silently commit something the user meant to exclude. The decision is now visible in
the command, the console output and the phase report instead of being buried in a
deleted JSON entry.
**Status:** self-resolved, no plan.md change needed. p7 stays blocked on the Phase 4b
schema decision; p13 stays out until the user decides what to do with a task whose
keys the model invented.

---

## [Phase 04] No unit teaching vocabulary is reachable at the current pointer — Tier: Moderate
**Finding:** All 16 seeded `vocab_words` belong to units 2 and 12 (8 each). The
pointer is at unit 1 and `unit_completions` is empty, so `/unit/2` and `/unit/12`
both hit the Phase 01 guard (`status === "locked"` → redirect to `/`). The Vocab
triage step therefore cannot be reached through the UI at all right now, and the
warm-up deck can only ever fill *after* it has been. The DoD anticipated this
("unit 2 is completed and read-only — use unit 12 if uncompleted, else a
bank-independent SQL check"), but in the live database neither branch holds: unit 2
is not completed, and unit 12 is not merely uncompleted, it is locked.
Reaching either would mean completing units on the user's behalf — writing
`unit_completions` and `study_log` rows that are their progress, not test data.
**Impact:** Phase 04's verification, and the shape of the user's first session: a new
user's day one has neither a Warm-up step (nothing in the deck) nor a Vocab step
(unit 1 teaches no words). The feature is invisible until unit 2. That is a content
consequence of how week 01 was authored, not a defect — worth the planning model
knowing when authoring weeks 3–4.
**How it was handled:** Took the architect's stated fallback and made it repeatable
rather than a one-off SQL session. `scripts/check_vocab_db.ts` issues the same
PostgREST calls in the same order as `src/lib/vocab.ts`, driving the same
`scheduleNext`, and asserts the DoD properties against the live database: 3 of unit
2's 8 words create exactly 3 cards, re-confirming the same words creates 0, a new
card is due today, Good at interval 0 lands on tomorrow with a `vocab_reviews` row,
Again then increments lapses, floors ease at ≥1.3, returns the card to tomorrow and
takes it out of today's due set. It refuses to modify any card that existed before
it ran and deletes every row it created, so it can be run on a real deck.
What it does not prove is that the pages render — `src/lib/vocab.ts` runs on the
request-scoped Supabase client, which needs a Next request and a signed-in session,
so the module itself cannot be called from a script. That is the same
browser-verification debt as Phases 01–03, not a new gap.
**Status:** self-resolved as far as an executor can. The UI-level check needs either
the browser walk-through or the user reaching unit 2 in normal use.

---

## [Phase 05] A seed file may now contain no units at all — Tier: Moderate
**Finding:** The task file asks `scripts/seed.ts` to accept a top-level `tests[]` for
bank tests authored by hand. `content/seed/writing_bank_01.json` turns out to contain
*only* that — no `units` key at all — while `parseSeedFile` had `units` as a hard
requirement (`fail("units", "is empty — nothing to seed")`) and returned `SeedUnit[]`.
Every downstream step in the seeder (the roadmap pointer invariant, the units upsert,
the vocab prune, the `test_ref` linking) also assumes at least one unit.
**Impact:** `scripts/seed.ts` and the shared validator's public signature, so
`ingest_commit.ts` and `ingest.ts` too. Not a plan-level change: `docs/plan.md` never
said a seed file must carry units, only that content is architect-authored data.
**How it was handled:** `parseSeedFile` now returns `{ units, tests }`, with each half
optional and a file carrying neither rejected at `<root>`. The seeder writes the bank
tests **first** and then returns early if `units` is empty, so a bank-only file never
reaches an upsert with no rows — and, because bank tests are written first, a unit in
the *same* file can reference one of them by `test_ref` (the slug resolver skips slugs
already written in this run). The id-stable slug upsert itself was extracted to
`scripts/lib/bank_upsert.ts` and is shared with `ingest_commit.ts` verbatim rather than
duplicated, as the task file required.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 05] A Task 1 prompt IS a markdown table, and `react-markdown` cannot render one — Tier: Moderate
**Finding:** The architect's ruling for this phase is that Task 1 prompts use described
data — markdown tables — because chart images are out of scope for the whole project.
So the table in `writing-t1-internet-vietnam` is not decoration, it is the question: a
candidate who cannot read the figures cannot answer. `react-markdown` implements
CommonMark, and pipe tables are a GitHub extension it renders only with `remark-gfm`.
Without it the prompt shows as a wall of `| 2005 | 10% | 30% |` lines. Adding the plugin
is a new dependency, and "no new dependency" is an explicit Definition-of-Done item.
**Impact:** the writing panel, and any later phase that renders architect markdown
containing a table.
**How it was handled:** `src/lib/md_tables.ts` (new, pure) splits a markdown string into
prose blocks and table blocks, recognising the shape a table is actually written in — a
pipe row, a delimiter row of dashes with optional alignment colons, then body rows until
the first non-pipe line. `MarkdownWithTables` renders the table blocks as real
`<table>` elements with the design's tokens and hands every prose block to
`react-markdown` untouched. Escaped pipes (`\|`) are deliberately NOT supported: no seed
content uses one, and a half-working escape rule would be worse than an absent one.
Pinned by fixture (the real Task 1 prompt, a prompt with no table, pipes without a
delimiter row, alignment colons, two tables in one prompt) and by a `react-dom/server`
render asserting every data cell reaches the markup and no delimiter row leaks.
**Status:** self-resolved, no plan.md change needed. If a later phase needs full GFM
(footnotes, strikethrough, task lists), that is the point to weigh `remark-gfm` properly
rather than extending this parser.

---

## [Phase 05] `countWords` is named in a server-only contract but is needed on every keystroke — Tier: Moderate
**Finding:** The Phase 05 contract puts `countWords` in `src/lib/writing.ts`, marked
server-only, and also asks for "a live word counter that turns accent-colored at
`min_words`". A live counter runs in the browser on every keystroke. Importing
`countWords` from `writing.ts` in a client component would pull `writing.ts` → `ai.ts` →
`config.ts` into the client bundle — the module that reads `AI_API_KEY`. Nothing would
leak (the key is not a `NEXT_PUBLIC_` variable, so its value is never inlined), but the
AI client would be shipped to the browser, and the CLAUDE.md rule that `config.ts` is the
only file reading `process.env` exists precisely to keep that boundary legible.
**Impact:** the shape of `src/lib/writing.ts`'s exports, and any later feature that wants
a pure helper out of a server-only module.
**How it was handled:** the counting rule lives in `src/lib/words.ts` (pure, no imports)
alongside `MIN_ESSAY_WORDS`, and `writing.ts` re-exports both — so the contract's surface
is exactly as specified, there is one implementation, and the client imports from
`words.ts`. Verified after `next build`: the rubric prompt string appears in **zero**
files under `.next/static`.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 05] Next.js redacts server-action errors, so the under-50-word refusal needs a client half — Tier: Moderate
**Finding:** The contract says "`< 50` words: the caller refuses BEFORE any AI call (no
token spend); the attempt stays unsubmitted and **the UI says why**". Implemented purely
server-side, `submitEssayAttempt` throws `EssayTooShortError` with a message naming the
word count — and in a production build Next.js replaces the message of any error thrown
in a server action with a generic "An error occurred in the Server Components render",
keeping only a digest. The user would see a redacted error instead of "29 words is not
enough to grade". The zero-token property would hold; the "says why" half would not.
**Impact:** every server action that means to explain a refusal to the user, not just
this one.
**How it was handled:** the refusal is enforced on both sides. Both players count the
words before calling the action and, under the threshold, never issue the request at all
— they render `EssayRefusal`, which names the count, the threshold and the fact that
nothing was saved. `submitEssayAttempt` refuses again on the server and remains
authoritative for any other caller. Both halves spend zero tokens, and the fixture
asserts zero model calls at 49 words and exactly one at 50.
**Status:** self-resolved, no plan.md change needed. Worth remembering for any later
refusal that needs to reach the user as prose.

---

## [Phase 05] The ingestion shape cannot carry a writing task, so staged writing tests are refused — Tier: Moderate
**Finding:** The new validator rule says a `writing` test carries `task_type`,
`min_words` and `prompt_md` in its `content`. `StagedTest.content` is parsed by
`parseStagedContent`, which keeps exactly two fields — `passage_md` and `transcript_md` —
and drops everything else. So a writing test arriving through `ingest.ts` would be
committed with a `content` that has no task in it: `readEssayTask` would return null,
`PlayerTest.essay` would be null, and the player would show "this test contains essay
question(s), which are not yet supported" on a test that is nothing but an essay.
**Impact:** `scripts/lib/validate.ts`, shared by `ingest.ts` (soft) and
`ingest_commit.ts` (hard). No writing test has ever been staged, so nothing existing
changes.
**How it was handled:** the writing rules are applied to seed tests, where the whole
`content` object is preserved verbatim, and a staged test whose skill is `writing` is
reported through the sink — a warning in `ingest.ts`'s review.md, a hard abort in
`ingest_commit.ts`. This is an addition the task file did not ask for; it is a refusal,
not an invention, and it keeps a half-formed writing test out of the database rather
than letting one in silently broken. Writing tasks are authored in a seed file, which is
where `writing_bank_01.json` already puts them.
**Status:** self-resolved, no plan.md change needed. If writing tasks ever *should* be
ingestible, `StagedTest.content` needs the three fields and `ingest.ts` needs a prompt
that extracts them — a Phase-level decision, not a validator tweak.

---

## [Phase 06] Re-grading stored answers on read can disagree with the stored `score_raw` — Tier: Moderate
**Finding:** The task file's contract for `getQTypeBreakdown` says to re-grade every
submitted attempt's stored answers through the existing pure `gradeAnswers`, never to
persist per-question results. Doing so revealed that the two numbers do not reconcile
against the current database: the breakdown finds **16 correct out of 22 answered**,
while the sum of `score_raw` across the same three objective attempts is **18**.

The gap is not a bug in either. Two answers on `…-p2` (Table Completion) were submitted
in the *joined* form the printed key used — `"two to five / 2-5"` and
`"South African tunnelling/tunnelling"` — and were correct against the key as it stood
that day. Phase 04's authorized mechanical normalization then split slash-separated
answer-key variants into separate entries, so the key is now `["two to five", "2-5"]`.
The old joined answer matches neither entry. `score_raw` is what the answer scored **on
the day it was submitted**; the breakdown is what that same answer scores **against the
key as it stands today**.
**Impact:** `src/lib/dashboard.ts`. Any figure derived by re-grading (the whole
question-type table) can drift from any figure read off the attempt row (the trajectory's
`accuracyPct`, `/bank`'s best-result column, the review screen the user saw at the time).
The drift only ever appears where content has legitimately changed under a stored answer.
**How it was handled:** kept as specified, because today's key is the authoritative one —
a weakness table that grades against a key the content team has since corrected would be
measuring the wrong thing. The two numbers are not made to agree and are not presented as
interchangeable: the trajectory shows the score as recorded, the breakdown shows accuracy
against the current key, and `scripts/check_dashboard_db.ts` prints both totals side by
side and names every answer responsible whenever they differ. The alternative —
persisting per-question results at submission time — is a schema change this phase
explicitly forbids, and would freeze a wrong answer as correct forever.
**Status:** self-resolved, no plan.md change needed. Worth knowing before any future
"total questions correct" figure is added: it must state which of the two definitions it
uses.

---

## [Phase 06] The verbatim-in-essay filter cannot hold TR's evidence — Tier: Moderate
**Finding:** The calibration ruling asks for per-criterion `errors` as "verbatim quotes
of the specific errors found for that criterion", listing **unaddressed task parts for
TR**, and separately asks the code to "apply the same verbatim-in-essay filter to
`errors` entries". Those two instructions conflict for TR alone: a part of the task the
candidate *did not address* has, by definition, nothing in the essay to quote. A TR entry
naming the missing content would be a quote of the task prompt, and the filter would drop
it every time.
**Impact:** `src/lib/writing.ts` (`filterVerbatimErrors`). TR only; CC, LR and GRA all
quote things the candidate actually wrote.
**How it was handled:** the filter was implemented exactly as specified — verbatim against
the essay, for all four criteria — because a fabricated quote is the failure mode the
filter exists to prevent, and softening it for one criterion would have reopened it for
all. The prompt was written around the constraint instead: TR is told to quote a sentence
only where the essay *itself* goes off task or is template filler, and to carry a genuinely
missing task part in its **comment** rather than in `errors`. Nothing is lost
mechanically, because TR's cap is prompt-level; only LR's is enforced in code. The live
re-run confirmed the shape: TR came back with `errors: []` and a comment that assessed
coverage in prose.
**Status:** self-resolved, no plan.md change needed.

---

## [Phase 06] Only one of the four evidence-tied caps is reliably self-applied — Tier: Moderate
**Finding:** Rubric v2 states four caps and the code enforces one (LR ≤ 6.0 on three or
more surviving spelling/word-form errors). The live re-run showed the model applying the
prompt-level caps *inconsistently*: it correctly held CC at 6.5 and quoted the mechanical
`Firstly,` / `Secondly,` / `Moreover,` chain as its reason, but for GRA it wrote "these
errors occur in roughly a third of the sentences, capping the score at 6.5" — invoking a
cap whose stated value is **6.0** and then awarding 6.5. It also reasoned explicitly and
correctly about the LR cap ("With two errors, the '3 or more' cap is not triggered"),
which is evidence the caps are being read rather than ignored.
**Impact:** `src/lib/writing.ts`'s prompt. The three prompt-level caps are guidance the
model half-applies; only the code-enforced one is a guarantee.
**How it was handled:** left as the ruling specifies — the other three caps need reading
comprehension to apply (what counts as "a third of the sentences", whether a linker chain
is load-bearing, whether a task part is addressed) and cannot be counted mechanically
without a second model call. The `errors` inventory is the mitigation that matters: the
user can now see the three GRA sentences the model based that cap on and judge the number
themselves, which is exactly what the "AI estimate ±0.5" label asks them to do. The net
effect on the sample essay was still the intended one — overall 7.0 → 6.5.
**Status:** self-resolved, no plan.md change needed. If GRA proves persistently generous
across more essays, its cap is the next candidate for code enforcement: error count
against sentence count is countable, unlike the CC and TR rules.
