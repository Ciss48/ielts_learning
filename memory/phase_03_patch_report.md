# Phase 03 patch report — hybrid text/vision extraction

**Executed:** 2026-08-17. Task file: `tasks/phase_03_patch_text_extraction.md`.
Staging only — **`ingest_commit.ts` was NOT run**, per the task and the Phase 03
contract. The database is byte-untouched by this patch.

## Done

### `hasTextLayer` — the routing decision (`scripts/ingest.ts`)
Implemented verbatim to the locked contract:
`hasTextLayer(pdfPath, pageRange): boolean`, per page `pdftotext -layout -f N -l N`,
page passes on **≥40 non-whitespace characters AND ≥60% printable ASCII / common
Latin punctuation**. One addition the contract left open: a *range* passes when at
least half its pages do. Real books are full of running-footer-only pages — page 23
of this source is literally `Page 23 of 46  IELTS.org`, 19 characters — and an
all-must-pass rule would send a perfectly good born-digital PDF to vision on the
strength of one near-blank page.

Sampled once per file (first 3 pages + 1 middle), never per chunk. Verdict for
`ielts-academic-reading-sample-tasks-2023.pdf`:

```
Extraction path: TEXT (text layer detected, 3/4 sampled pages passed) — no vision
calls made, no image/token-per-minute limits apply. Sample — p1: 547 chars, 100%
printable; p2: 3114 chars, 100% printable; p3: 2977 chars, 100% printable;
p23: 19 chars, 100% printable.
```

That line is printed to the console and written into `review.md`, together with
`Vision calls made in this run: **0**.`

### TEXT extraction path
- `pdftotext -layout` over the whole file, split on `\f`, **5 pages per `textChat`
  call** (the task's ≤5 ceiling; no image constraint applies any more).
- The extraction prompt is now **one function shared by both paths**
  (`extractionPrompt(mode, …)`), so fidelity rules 1–6 cannot drift between them.
  The only difference is the opening: TEXT mode states the input is already
  transcribed plain text and must be copied, not re-worded or summarised.
- `max_completion_tokens` is raised to 16,384 for TEXT chunks via a new optional
  `ChatOptions` argument on `textChat`. Five pages of dense passage transcribe to
  far more than the 4k default, and a truncated completion is unparseable JSON —
  i.e. a silently lost chunk. Nothing charges for the reservation on a text call;
  the vision path's 4k default is untouched because there it *is* a rate-limit
  budget item.
- **Adaptive splitting.** A span whose call fails or whose response is unparseable
  is halved and retried, down to a single page; a single page gets one more attempt
  and is then reported in `review.md` and skipped. Losing one page to a warning
  beats losing the other forty-five. Neither was needed in the final run.
- Logs are named by page span (`text-p001-p005.txt`), so a split retry cannot
  collide and document order survives any splitting. Failed responses are kept as
  `failed-text-*.txt`, which `--from-logs` ignores.
- `--from-logs` prefers text logs when present, else vision logs, and never mixes
  them (replaying both would stage every page twice). The Phase 03 vision cache is
  kept, not deleted.

### VISION path
Unchanged, and now reached only when `hasTextLayer` is false. `visionChat` calls
are counted in `visionCallCount`, printed at the end of every run and recorded in
`review.md`.

### `preflight`
Requires both `pdftotext` and `pdftoppm`; the "needs a vision-capable model"
message is gone, because it is no longer true for text-layer sources.

## Full re-run outcome

Clean run — text logs deleted first, no `--resume`, `--force` only:

```
pages 1–5 … 10–46 (10 spans, none split, none failed)
merge pass over 18 fragments … 18 test(s)
staged 13 test(s), 55 question(s)
Done. 0 vision call(s) made.                     exit code 0
```

**All 46 pages in one run**, against an OpenCode Zen free-tier *text* model. No
daily-token wall, no rate-limit stall, no vision model involved. Compare Phase 03:
28 of 46 pages, ~199,568 tokens, quota exhausted.

`content/staged/ielts-academic-reading-sample-tasks-2023.json` now holds **13
tests, 55 questions, 0 missing answer keys, 44 questions with an explanation**
(Phase 03 staged 6 committable tests, 22 questions, 0 explanations). It **passes
the hard validator** — checked by calling `parseStagedFile(…, "hard")` directly,
not by running `ingest_commit.ts`. Passing hard validation means it is *shaped*
right, not that every key is *correct*; see "Open issues".

The 13 staged tests are exactly the 13 tasks the source's own contents page lists,
in printed order.

| slug | task | qs | qnums |
| --- | --- | --- | --- |
| `…-p1` | Matching Features | 4 | 7–10 |
| `…-p2` | Table Completion | 5 | 9–13 |
| `…-p3` | Flow-chart Completion: selecting words from the text | 3 | 1–3 |
| `…-p4` | Identifying Information: True/False/Not Given | 3 | 1–3 |
| `…-p5` | Matching Headings | 4 | 1–4 |
| `…-p6` | Matching Sentence Endings | 3 | 1–3 |
| `…-p7` | Multiple Choice: more than one answer | 4 | 1–4 |
| `…-p8` | Multiple Choice: one answer | 4 | 1–4 |
| `…-p9` | Note Completion | 6 | 1–6 |
| `…-p10` | Sentence Completion | 5 | 1–5 |
| `…-p11` | Summary Completion: selecting from a list of words or phrases | 4 | 1–4 |
| `…-p12` | Summary Completion: selecting words from the text | 5 | 1–5 |
| `…-p13` | Diagram Label Completion | 5 | 1–5 |

Pages 29–46 — previously unreachable — are staged as **p8 onward**, which is the
task's requirement met exactly.

## Cross-check against the committed bank tests (task step 4)

**Slug mapping: no drift.** New `p1`–`p6` are the same six tasks as the committed
`p1`–`p6`. This is the risk STATE.md flagged, and it survived — but only after two
fixes below; the first assembly of this run *did* mis-map `p6`.

**Titles drifted, deliberately and visibly.** The text path reads the printed
running heading, so `p3`–`p6` are now titled by task type
(`Academic Reading Sample Task – Matching Headings`) where the vision path used the
passage title (`The Physics of Traffic Behavior`). Same test, different display
title. Re-committing would rename four bank tests. **That is a content decision for
the user, not one an executor makes.**

**Answer keys: 20 of the 22 committed keys are byte-identical after
normalisation.** The two differences are both the *new* run being more faithful:

| | committed (vision) | new (text) |
| --- | --- | --- |
| p2 q11 | `["two to five / 2-5"]` | `["two to five", "2-5"]` |
| p2 q13 | `["South African tunnelling/tunnelling"]` | `["South African tunneling", "South African tunnelling"]` |

- p2 q11 is fidelity rule 4 finally working ("one entry per printed variant"),
  which closes the Phase 03 gap where a correct answer graded wrong. It happens
  because a 5-page chunk holds the question and its printed key together.
- p2 q13 fixes the Phase 03 transcription deviation: the source prints
  `tunneling` (US) then `tunnelling` (UK), and the vision run had rendered both as
  `tunnelling`. The new second variant is expanded to `South African tunnelling`
  rather than the bare `tunnelling`; this is flagged in `review.md` and is still a
  judgement call for the user.

## New findings

Three Moderate discoveries, all logged in `memory/discoveries.md`, **no Major, no
`docs/plan.md` change required.**

1. **The merge pass ignores its own `continues_previous` rule.** A task straddling
   a chunk boundary is transcribed as two fragments — one with the questions and
   their options, one with the passage and an option-less second copy of the
   questions — and the merge model emitted them as two separate, uncommittable
   tests. This is what mis-mapped `p6` on the first assembly. Fixed deterministically
   in `joinContinuations`: a fragment marked `continues_previous` whose printed
   title *exactly* matches the fragment before it is folded back into that test, in
   code, with the join reported in `review.md`. Strict title equality is the guard,
   because the failure Phase 03 warned about (the flag staying true across a real
   task boundary) always shows up as two different printed titles. Question numbers
   deliberately do **not** guard it: a re-transcribed task repeats its own numbers,
   and `assemble` de-duplicates them, keeping the copy that came with its options.
   **5 such joins occurred in the final run.**
2. **A key the model fills in-chunk skipped the printed-label dereference.** With
   pages 3–5 in one chunk the model answers from the answers page itself, so
   `attachAnswers` — which only ever touched *empty* keys — never ran, and p1 came
   out keyed `"A"` while its options read `"A the Chinese"`. Every correct answer
   would grade wrong, and the hard validator would reject the commit. Fixed with a
   pass 0 in `attachAnswers` that applies the existing `resolveAnswer` to keys that
   arrived with the question. 23 label substitutions in the final run.
3. **An in-chunk key can drift from the printed key, and nothing checked it.**
   Because the model can now see the passage, it sometimes answers from the passage
   instead of copying the printed key — fidelity rule 2's exact failure mode. The
   printed answers page is still extracted separately, so `apply` now **cross-checks
   an already-filled key against it and reports every disagreement** instead of
   trusting the model. This immediately caught all five fabricated
   Diagram-Label-Completion keys (see Open issues) and, on an earlier assembly,
   p3 q3 padded from `preservation` to `preservation of the organism`. A key
   transcribed as the slash-split of the printed key (rule 4's intended behaviour)
   is recognised and not reported as drift.

## Decisions made

- **Slug indices are assigned only to tests that are actually staged.** Previously
  an entry that turned out to have no questions still consumed an index, leaving
  holes (`p7`, `p11`, `p13` missing). The locked convention is "`-p<N>` by order of
  appearance", and something that never appears must not consume an N. With this
  and fix 1, numbering lands on the 13 printed tasks in order.
- **`.env.local`'s `AI_MODEL` was changed** from `laguna-s-2.1-free` (returns
  `HTTP 503 Endpoint is unavailable` on every request) to `nemotron-3-ultra-free`,
  which was probed and works. `AI_BASE_URL` and the key are untouched, and no key
  was ever printed. Of the six OpenCode Zen free models, `nemotron-3-ultra-free`,
  `nemotron-3.5-lightning-free` and `hy3-free` answer; `deepseek-v4-flash-free` and
  `mimo-v2.5-free` return `FreeUsageLimitError`.
- **`textChat` gained an optional second argument** (`ChatOptions`), not a changed
  default. Existing callers — including the merge pass — are unaffected.
- **Nothing was corrected in the content itself.** Every fabrication, expansion and
  spelling difference is a warning in `review.md` for the user to resolve.

## Open issues

1. **`…-p13` (Diagram Label Completion) has five fabricated answer keys.** The
   model's own warning says it plainly — *"Answer key for Diagram Label Completion
   questions 1-5 not found in provided pages; answers inferred from passage text"* —
   and the new cross-check flags all five against the printed page 46 key. Fidelity
   rule 5 says diagram tasks should be skipped outright. **Do not commit p13.**
   Removing it is a content decision left to the user.
2. **`…-p7` is still blocked on the missing multi-select question type**, and is
   still detected and warned about (2 warnings), not fabricated into single-answer
   form. Unchanged plan-level gap from Phase 03.
3. **Re-committing renames four bank tests** (p3–p6 titles). Needs a decision before
   any commit.
4. **61 warnings in `review.md`** — that is the file to read before committing, not
   this report.
5. **Browser verification is still outstanding**, unchanged and unrelated.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
- `npm run build` — clean, all 7 routes present.
- Full clean re-run exit code 0, `0 vision call(s) made`, 10/10 spans transcribed,
  0 failed spans, 0 pages missing.
- `parseStagedFile(staged, "hard")` — PASS (55/55 questions; choice keys verbatim
  from `options`, no empty keys).
- Committed p1–p6 key comparison: 20 identical, 2 differing (both documented above).
- `git check-ignore` still covers `content/raw/` and `content/staged/`; no
  `content/` entry appears in `git status`.

## Input for the next session

- **Ingestion no longer needs a vision model or a token budget** for born-digital
  sources. `hasTextLayer` decides per file; scanned sources still route to vision
  automatically. The Phase 03 finding "provider limits, not code, are the constraint
  on ingestion" now applies only to genuinely scanned material — **and to Phase 05,
  which is text-only and therefore unaffected either way.**
- **The staged file supersedes the 6 committed bank tests** but is deliberately not
  committed. Commit is a separate, user-confirmed step, and it should follow a
  decision on p13, p7 and the title rename.
- **The 28 cached Phase 03 vision responses are still on disk** and are ignored
  while text logs exist.
