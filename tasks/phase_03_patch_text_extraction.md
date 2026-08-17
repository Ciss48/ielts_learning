# Patch: hybrid text/vision extraction for `scripts/ingest.ts`

## Context Recap
Phase 03 (`memory/phase_03_report.md`) built `scripts/ingest.ts` unconditionally
using `visionChat` on rendered page images. This was designed for the worst
case (scanned photos of physical books, which have no text layer). But the
first real source, `ielts-academic-reading-sample-tasks-2023.pdf`, is
**born-digital** — it has a real, selectable text layer (the Phase 03 fidelity
spot-check already proved this, using `pdftotext -layout` as its independent
reference). Routing a born-digital PDF through vision was unnecessary: it
burned the shared vision-only rate/token budget for no accuracy benefit, and
made ingestion depend on a vision-capable model even when one wasn't needed.

## Goal
`ingest.ts` detects, per source file, whether a usable text layer exists. If
yes, extraction runs on **text** (`textChat`, no image/vision constraints at
all — any OpenAI-compatible text model works, including free-tier ones). If
no (scanned images), it falls back to the existing vision path unchanged.

## Non-goals
- No change to the staged JSON schema, `ingest_commit.ts`, the validator, or
  the extraction prompt's fidelity rules — those apply identically to both
  paths.
- No OCR fallback for scanned pages beyond what vision already does.
- Do not re-run this patch's logic against already-committed tests; it only
  affects future/resumed `ingest.ts` runs.

## Interface Contract

### Text-layer detection (per file, before any AI call)
```ts
/** Heuristic: extract each page with `pdftotext -layout -f N -l N`, then
 *  treat the page as "real text" if its output has at least 40 non-whitespace
 *  characters AND at least 60% of characters are printable ASCII or common
 *  Latin punctuation (guards against PDFs whose "text layer" is garbage/
 *  ligature-broken glyph soup, which some scan-to-PDF tools still embed). */
export function hasTextLayer(pdfPath: string, pageRange: [number, number]): boolean;
```
Run detection once per file (not per chunk) on a small sample (first 3 pages
+ 1 middle page). Log the verdict and the sampled ratio in `review.md`.

### Text extraction path (new, used when `hasTextLayer` is true)
1. `pdftotext -layout` the whole file to plain text, page-delimited (`\f`).
2. Chunk by page count matching the current vision chunk size (still ≤5
   pages/call — no image constraint drives this anymore, but keeping chunks
   small keeps context focused and errors localized).
3. Call `textChat` with the same Appendix extraction prompt from
   `tasks/phase_03_ingestion.md`, adapted only to say the input is already
   transcribed plain text (not images) — fidelity rules 1–6 apply unchanged,
   including "transcribe, never paraphrase" (the model must still preserve
   the text verbatim, not summarize it) and the per-chunk answer-key honesty
   rule.
4. Everything downstream (merge pass, answer-page dereferencing, staged JSON,
   `review.md`, logs) is unchanged — both paths converge on the same staged
   format.

### Vision path (existing, used when `hasTextLayer` is false)
Unchanged from Phase 03.

### `review.md` addition
One line per source file stating which path ran and why:
`Extraction path: TEXT (text layer detected, 4/4 sampled pages passed) — no
vision calls made, no image/token-per-minute limits apply.` or `Extraction
path: VISION (no reliable text layer detected) — subject to the configured
model's image limits.`

## Steps
1. Implement `hasTextLayer` and the text extraction path in `ingest.ts`.
2. Re-run detection against the existing cached file: confirm it reports TEXT.
3. Re-run extraction end-to-end on this source using the text path — this
   should complete all 46 pages in one run, no daily-quota exhaustion, and
   work against whichever text-capable key is currently in `.env.local`
   (Groq or OpenCode Zen free tier both qualify — neither needs vision).
4. Cross-check the newly extracted p1–p6 against the already-committed
   versions: content should match (same passages/questions/keys); note any
   drift in the phase report rather than silently overwriting if drift exists.
5. Extract and stage pages 29–46 (previously unreachable) via the text path.

## Definition of Done
- `hasTextLayer` returns true for `ielts-academic-reading-sample-tasks-2023.pdf`
  and the reasoning (sampled ratio) is logged.
- A full re-run of this file completes end-to-end via the TEXT path with
  **zero calls to `visionChat`** (grep the run's log directory for evidence,
  or instrument a call counter) and without hitting a daily token cap.
- Newly staged p1–p6 match the committed bank tests' content (or drift is
  explicitly reported); p7 (multi-select) and any newly found similar
  questions are still flagged, not fabricated into a single-answer form.
- Pages 29–46 produce staged tests p8 onward, validated soft, with a
  `review.md` the user can read before any commit — **do not run
  `ingest_commit.ts` in this patch**; that stays a separate, user-confirmed
  step per the existing Phase 03 contract.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` clean.

## Handoff Obligations
1. Append a short note to `memory/phase_03_report.md` (or a
   `memory/phase_03_patch_report.md` if cleaner) describing the fix and the
   full re-run outcome.
2. Overwrite `memory/STATE.md`.
3. Log in `memory/discoveries.md` if anything unexpected turned up (e.g. the
   text layer produces different content than the vision pass did for p1–p6).
