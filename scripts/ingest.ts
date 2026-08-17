/**
 * PDF → staged JSON. Extraction only: this script NEVER touches the database.
 *
 *   npx tsx scripts/ingest.ts                      # every un-staged PDF in content/raw/
 *   npx tsx scripts/ingest.ts content/raw/foo.pdf  # just this one
 *   npx tsx scripts/ingest.ts --force              # re-extract even if staged
 *   npx tsx scripts/ingest.ts --from-logs          # re-assemble from cached responses
 *   npx tsx scripts/ingest.ts --force --resume     # continue an interrupted extraction
 *   npx tsx scripts/ingest.ts --from-logs --no-merge  # group by printed title, no API call
 *
 * Pipeline, in two variants chosen per source file:
 *  - **TEXT** (born-digital PDFs, the common case): `pdftotext -layout` gives the
 *    embedded text layer, and each ≤5-page chunk goes to `textChat`. No images,
 *    so no vision model and no per-request image limit are involved.
 *  - **VISION** (genuinely scanned sources): `pdftoppm` renders pages to PNG and
 *    each chunk goes to `visionChat`, as in Phase 03.
 * Both converge on the same fragments, then a text pass decides how the chunks
 * join up and the staged JSON + a human-readable review.md are written to
 * content/staged/.
 *
 * `hasTextLayer` picks between them, sampled once per file. Routing a
 * born-digital PDF through vision is pure waste: it costs the shared vision
 * token budget, needs a vision-capable model, and is *less* accurate than the
 * publisher's own text layer.
 *
 * Two properties this script is built around:
 *  - Extracted content is a *draft*. Validation is soft here: rule violations
 *    become warnings in the review file rather than aborting, because the whole
 *    point is to show the user what the model got wrong before anything is
 *    committed (CLAUDE.md: AI-extracted content is never auto-inserted).
 *  - Transcribed text is never re-generated. The merge pass returns a *plan*
 *    (which chunk fragments belong to which test); the concatenation is done
 *    here in code, so passage and question text reach the staged file exactly as
 *    the vision pass transcribed it.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

import {
  parseStagedFile,
  ValidationError,
  type SeedQuestion,
  type StagedFile,
  type StagedTest,
  type TestSkill,
} from "./lib/validate";
import { normalizeAnswer } from "../src/lib/normalize";
import {
  DEFAULT_SPLIT_WORD_LIMIT,
  detectWordLimit,
  splitPrintedKey,
} from "./lib/answer_variants";

const RAW_DIR = resolve(process.cwd(), "content/raw");
const STAGED_DIR = resolve(process.cwd(), "content/staged");
const LOG_DIR = join(STAGED_DIR, "logs");

const RENDER_DPI = 150;

/**
 * Upper bound on pages per vision call, on top of the provider's image limit.
 *
 * The binding constraint is the token budget, not the image count. Groq's free
 * tier allows 8k tokens per minute and admits a request against
 * `input + max_completion_tokens`, so one 150-DPI page (~2.4k input) plus the
 * 4k output reservation already uses most of a window; two pages do not fit.
 * Raise this on a paid tier — the rest of the pipeline is unaffected, because
 * fragments are stitched back together by the merge pass either way.
 */
const MAX_PAGES_PER_CHUNK = 1;

/**
 * Pages per call on the TEXT path.
 *
 * No image limit applies here and the input is cheap, so the bound is only
 * "keep the context focused and errors localised" — plus the output cap below,
 * since every page in the chunk has to be transcribed back out. Five is the
 * ceiling the task file sets. A chunk that overruns the cap is split and
 * retried rather than lost (see `transcribeTextSpan`).
 */
const TEXT_PAGES_PER_CHUNK = 5;

/**
 * Output cap for a TEXT chunk. Five pages of dense reading passage transcribe
 * to well over the 4k default, and a truncated response is unparseable JSON —
 * i.e. a lost chunk. Nothing charges us for the reservation on a text call.
 */
const TEXT_MAX_COMPLETION_TOKENS = 16_384;

// --- text-layer detection thresholds ----------------------------------------

/** Below this many non-whitespace characters, a page carries no usable text. */
const MIN_TEXT_CHARS = 40;

/** Share of characters that must be printable ASCII / common Latin punctuation. */
const MIN_PRINTABLE_RATIO = 0.6;

/** Duration defaults when the source does not print one. */
const DEFAULT_DURATION: Record<"reading" | "listening", number> = {
  reading: 20,
  listening: 10,
};

class IngestError extends Error {}

// --- the model's per-chunk output shape --------------------------------------

/**
 * What one vision call returns. Deliberately looser than `StagedTest`: a
 * fragment may be a passage with no questions yet, or questions whose passage
 * was on an earlier page. `continues_previous` is how the model says "this is
 * the tail of the fragment you showed me from the last chunk".
 */
interface Fragment {
  /** Stable within this run: chunk index + position, assigned by us. */
  id: string;
  title: string;
  skill: string;
  task_type: string;
  passage_md: string | null;
  transcript_md: string | null;
  questions: unknown[];
  continues_previous: boolean;
  warnings: string[];
}

/**
 * A page that prints answers rather than questions.
 *
 * These have to be captured separately because a source may print its key on
 * its own page (this one does, after every task) or in a combined section at
 * the back — either way the key is rarely on the same page as the questions,
 * and the model is forbidden to guess. `for_title` is what links them back.
 */
interface AnswerPage {
  id: string;
  for_title: string;
  answers: Array<{ qnum: number; answer: string[] }>;
}

interface ChunkResult {
  fragments: Fragment[];
  answer_pages: unknown[];
  warnings: string[];
}

interface MergePlanEntry {
  fragment_ids: string[];
  title: string;
  skill: string;
}

interface MergePlan {
  tests: MergePlanEntry[];
  warnings: string[];
}

// --- preflight ---------------------------------------------------------------

async function preflight(): Promise<void> {
  // Both ship with poppler. pdftotext decides the extraction path and drives it
  // for born-digital sources; pdftoppm is only needed if we fall back to vision,
  // but a source that needs it should fail at preflight, not 40 pages in.
  for (const tool of ["pdftotext", "pdftoppm"] as const) {
    try {
      execFileSync(tool, ["-v"], { stdio: "pipe" });
    } catch {
      throw new IngestError(
        `${tool} (poppler) is not installed — it is needed to read PDF pages.\n` +
          "  macOS:  brew install poppler\n" +
          "  Debian: sudo apt install poppler-utils",
      );
    }
  }

  // Credentials are read through config.ts only; this script never touches
  // process.env itself. Imported dynamically so `loadEnvFile` above runs first.
  const { config } = await import("../src/lib/config");
  if (!config.ai.apiKey) {
    throw new IngestError(
      "AI_API_KEY is not set in .env.local — extraction needs a chat model.",
    );
  }
  console.log(`Model: ${config.ai.model} @ ${config.ai.baseUrl}`);
}

// --- text-layer detection ----------------------------------------------------

/** `pdftotext -layout` over one page range, to stdout. Empty string on failure. */
function pdfToText(pdfPath: string, pageRange?: [number, number]): string {
  const args = ["-layout"];
  if (pageRange) args.push("-f", String(pageRange[0]), "-l", String(pageRange[1]));
  args.push(pdfPath, "-");
  try {
    return execFileSync("pdftotext", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // A PDF with no text layer at all can make pdftotext exit non-zero. That is
    // itself the answer: no text.
    return "";
  }
}

/**
 * Characters a genuine Latin-script text layer is made of: printable ASCII plus
 * the typographic punctuation a word processor emits (curly quotes, en/em
 * dashes, ellipsis, bullets, non-breaking space) and the odd accented letter.
 * Anything else — replacement characters, private-use glyphs, control bytes —
 * is the signature of a broken or synthetic "text layer".
 */
const PRINTABLE = /[\u0020-\u007E\u00A0-\u024F\u2010-\u2027\u2030-\u205E\u20AC\u2122]/;

interface PageProbe {
  page: number;
  chars: number;
  ratio: number;
  ok: boolean;
}

function probePage(pdfPath: string, page: number): PageProbe {
  const text = pdfToText(pdfPath, [page, page]);
  const dense = text.replace(/\s/g, "");
  const printable = [...dense].filter((c) => PRINTABLE.test(c)).length;
  const ratio = dense.length === 0 ? 0 : printable / dense.length;
  return {
    page,
    chars: dense.length,
    ratio,
    ok: dense.length >= MIN_TEXT_CHARS && ratio >= MIN_PRINTABLE_RATIO,
  };
}

/**
 * Heuristic: extract each page with `pdftotext -layout -f N -l N`, then treat
 * the page as "real text" if its output has at least 40 non-whitespace
 * characters AND at least 60% of characters are printable ASCII or common Latin
 * punctuation (guards against PDFs whose "text layer" is garbage/ligature-broken
 * glyph soup, which some scan-to-PDF tools still embed).
 *
 * A *range* passes when at least half its pages do. Real books are full of
 * pages that carry nothing but a running footer — page 23 of the IELTS sample
 * booklet is literally "Page 23 of 46  IELTS.org", 27 characters — and demanding
 * every sampled page pass would route a perfectly good born-digital PDF through
 * vision on the strength of one near-blank page.
 */
export function hasTextLayer(pdfPath: string, pageRange: [number, number]): boolean {
  const [first, last] = pageRange;
  const probes: PageProbe[] = [];
  for (let page = first; page <= last; page += 1) probes.push(probePage(pdfPath, page));
  if (probes.length === 0) return false;
  return probes.filter((p) => p.ok).length / probes.length >= 0.5;
}

interface TextLayerVerdict {
  usesText: boolean;
  passed: number;
  sampled: number;
  probes: PageProbe[];
}

/**
 * The per-file verdict. Sampled once, never per chunk: the first three pages
 * plus one from the middle, which is enough to tell a born-digital PDF from a
 * scan without paying to probe 46 pages.
 */
function detectTextLayer(pdfPath: string, totalPages: number): TextLayerVerdict {
  const sample = [...new Set([1, 2, 3, Math.max(1, Math.ceil(totalPages / 2))])]
    .filter((page) => page <= totalPages)
    .sort((a, b) => a - b);

  const probes = sample.map((page) => probePage(pdfPath, page));
  const passed = probes.filter((p) => hasTextLayer(pdfPath, [p.page, p.page])).length;

  return {
    usesText: sample.length > 0 && passed / sample.length >= 0.5,
    passed,
    sampled: sample.length,
    probes,
  };
}

/** The one-line explanation of the routing decision, for console and review.md. */
function pathNoteFor(verdict: TextLayerVerdict): string {
  const detail = verdict.probes
    .map((p) => `p${p.page}: ${p.chars} chars, ${Math.round(p.ratio * 100)}% printable`)
    .join("; ");

  return verdict.usesText
    ? `Extraction path: TEXT (text layer detected, ${verdict.passed}/${verdict.sampled} ` +
        `sampled pages passed) — no vision calls made, no image/token-per-minute ` +
        `limits apply. Sample — ${detail}.`
    : `Extraction path: VISION (no reliable text layer detected, ${verdict.passed}/` +
        `${verdict.sampled} sampled pages passed) — subject to the configured model's ` +
        `image limits. Sample — ${detail}.`;
}

/** The whole file as plain text, one entry per page (pdftotext delimits with \f). */
function extractPageTexts(pdfPath: string): string[] {
  const raw = pdfToText(pdfPath);
  const pages = raw.split("\f");
  // pdftotext emits a form feed after the last page, so the split leaves a
  // trailing empty entry that is not a page.
  if (pages.length > 1 && pages[pages.length - 1].trim() === "") pages.pop();
  return pages;
}

// --- rendering ---------------------------------------------------------------

/** Renders the whole PDF to PNGs in a temp dir and returns them page-ordered. */
function renderPages(pdfPath: string): { dir: string; pages: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "ielts-ingest-"));
  try {
    execFileSync(
      "pdftoppm",
      ["-png", "-r", String(RENDER_DPI), pdfPath, join(dir, "page")],
      { stdio: "pipe" },
    );
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new IngestError(
      `pdftoppm failed on ${basename(pdfPath)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const pages = readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    // pdftoppm zero-pads to the page count, so lexical order is page order.
    .sort()
    .map((f) => join(dir, f));

  if (pages.length === 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new IngestError(`pdftoppm produced no pages for ${basename(pdfPath)}`);
  }

  return { dir, pages };
}

// --- prompts -----------------------------------------------------------------

/**
 * The architect-authored fidelity rules (tasks/phase_03_ingestion.md, Appendix),
 * used verbatim. Only the mechanical parts around it — page ranges, the output
 * schema, continuation context — are assembled per chunk.
 */
const FIDELITY_RULES = `You are transcribing pages from a real IELTS test book into structured data.
Fidelity rules, in priority order:
1. TRANSCRIBE, never paraphrase. Passage text, question prompts and options must
   be copied exactly as printed (rejoin words hyphenated across line breaks;
   keep paragraph breaks; keep paragraph labels like A/B/C).
2. Answer keys come ONLY from a printed answer section. Do not assume it is at
   the end of the document — some sources print the answer key immediately
   after each set of questions (per-passage or per-section), not only in one
   combined section at the back. Search the pages you were given for whichever
   layout applies. If truly not visible in these pages, output "answer_key": []
   and add a warning — NEVER guess an answer.
3. For choice questions (mcq / tfng / ynng / matching), every answer_key entry
   must be copied verbatim from that question's options array.
4. For gap_fill / short_answer, answer_key lists every accepted variant printed
   in the key (e.g. "led lamps / LEDs" becomes two entries).
5. qtype mapping: TRUE/FALSE/NOT GIVEN → tfng; YES/NO/NOT GIVEN → ynng;
   multiple choice → mcq; matching headings/features/endings → matching;
   sentence/summary/note/table completion → gap_fill; short answer →
   short_answer. Anything else (diagrams, writing tasks): skip it and record a
   warning naming the question numbers.
6. After transcribing each question and locating its printed answer, write a
   1–2 sentence explanation_md grounded in the passage text, quoting the exact
   phrase that justifies the answer. Mark nothing you cannot ground.
Output JSON only, no commentary, matching the provided schema.`;

/** Which form the pages reach the model in. The fidelity rules are identical. */
type InputMode = "images" | "text";

/**
 * The extraction prompt, shared by both paths so the fidelity rules cannot
 * drift between them. The only difference is how the pages arrive: as images to
 * read, or as text already extracted from the PDF's own text layer — which the
 * model must still copy verbatim rather than summarise.
 */
function extractionPrompt(
  mode: InputMode,
  firstPage: number,
  lastPage: number,
  totalPages: number,
  carry: string | null,
  pageText: string | null,
): string {
  const opening =
    mode === "images"
      ? `You are looking at pages ${firstPage}–${lastPage} of a ${totalPages}-page document,
in order.`
      : `Below is the plain text of pages ${firstPage}–${lastPage} of a ${totalPages}-page
document, in order, extracted from the PDF's own text layer with column layout
preserved by spacing. It is already transcribed — copy it, do not re-word it, do
not summarise it, and do not "clean it up". Rule 1 applies to this text exactly
as it would to a photograph of the page.`;

  return `${FIDELITY_RULES}

--- this request ---
${opening} One document may contain several independent tests or task sets; split
them into separate fragments. A fragment is one passage (or listening section)
together with the questions and printed answers that belong to it.

${
  carry
    ? `The previous chunk ended mid-fragment. Its tail was:
${carry}
If the first thing on these pages continues it, set "continues_previous": true on
that first fragment and transcribe ONLY the new text — do not repeat what was
already transcribed.`
    : `These are the first pages of the document; nothing carries over.`
}

Options must keep the letter or number they are printed with, as part of the
string: an option printed "A  the Chinese" is transcribed "A the Chinese", not
"the Chinese". The printed answer key refers to options by that label, so
dropping it destroys the link between a question and its answer.

IMPORTANT — ANSWERS PAGES. A page whose heading contains "(Answers)", or which is
just a list of question numbers against their answers with no question text, is an
ANSWERS page. It is NOT a task and NOT a fragment. For such a page:
  - "fragments" must be EMPTY;
  - put one entry in "answer_pages", with "for_title" set to the heading printed
    on that page and one {qnum, answer} row per printed answer;
  - copy each answer exactly as printed — a bare letter stays a bare letter.
Never turn answer rows into questions with prompts like "7".

Output exactly this JSON shape:
{
  "fragments": [
    {
      "title": "<the printed heading of this task/passage>",
      "skill": "reading" | "listening",
      "task_type": "<the printed task-type name, e.g. Matching Headings>",
      "passage_md": "<the passage text, markdown, or null if these pages have none>",
      "transcript_md": "<listening transcript, or null>",
      "questions": [
        {
          "qnum": <integer as printed>,
          "qtype": "mcq" | "tfng" | "ynng" | "matching" | "gap_fill" | "short_answer",
          "prompt": "<the question exactly as printed>",
          "options": ["<verbatim option, including its printed label>", ...] or null,
          "answer_key": ["<verbatim from the printed answer section>"],
          "explanation_md": "<1-2 sentences quoting the passage, or null>"
        }
      ],
      "continues_previous": false,
      "warnings": ["<anything skipped or unreadable, naming question numbers>"]
    }
  ],
  "answer_pages": [
    {
      "for_title": "<the heading printed on the answers page>",
      "answers": [{ "qnum": <integer>, "answer": ["<verbatim printed answer>", ...] }]
    }
  ],
  "warnings": ["<page-level problems>"]
}

Pages with only a cover, contents list or page footer produce no fragments and
no answer_pages.${
    mode === "text" && pageText !== null
      ? `

--- pages ${firstPage}–${lastPage}, verbatim ---
${pageText}
--- end of pages ---`
      : ""
  }`;
}

function mergePrompt(fragments: Fragment[], source: string): string {
  // Only metadata goes to the merge pass — never the transcribed text. The
  // model decides how fragments group; this script does the joining.
  const summary = fragments.map((f) => ({
    id: f.id,
    title: f.title,
    skill: f.skill,
    task_type: f.task_type,
    has_passage: f.passage_md !== null && f.passage_md.trim() !== "",
    passage_opening: f.passage_md ? f.passage_md.slice(0, 160) : null,
    passage_ending: f.passage_md ? f.passage_md.slice(-160) : null,
    question_count: f.questions.length,
    continues_previous: f.continues_previous,
  }));

  return `These fragments were transcribed from "${source}", in document order, by
separate passes over small page chunks. Group them into finished tests.

Rules:
- A test is one passage (or listening section) plus the questions belonging to it.
- A fragment with "continues_previous": true belongs to the same test as the
  fragment before it. Fragments whose passage_ending and passage_opening clearly
  run on into each other also belong together, as do question-only fragments that
  follow a passage they obviously belong to.
- Never merge two fragments that are plainly different tasks with different
  passages, even if they share a task_type.
- A sample book often reuses ONE passage for SEVERAL different tasks. Fragments
  with different task_types are different tests even when their passages are
  identical or nearly identical — for example a True/False/Not Given task and a
  Note Completion task on the same source text are two tests, not one. The
  printed title is the authority: different titles mean different tests.
- Question numbering restarts at 1 in each task, so two fragments that both
  start at question 1 are almost always different tests. Merging them would make
  their question numbers collide and answers would be lost.
- List fragment_ids in document order. Every fragment id must appear exactly once
  across all tests, unless it is junk (a cover page, contents list) — put those in
  "warnings" instead and leave them out.

Fragments:
${JSON.stringify(summary, null, 2)}

Output JSON only:
{
  "tests": [
    { "fragment_ids": ["..."], "title": "<the best title for the joined test>",
      "skill": "reading" | "listening" }
  ],
  "warnings": ["<fragments dropped and why>"]
}`;
}

// --- assembly ----------------------------------------------------------------

function slugifyBase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toTestSkill(raw: string): TestSkill {
  return raw === "listening" ? "listening" : "reading";
}

/** Shape-only coercion of one `answer_pages` entry; text is untouched. */
function toAnswerPage(raw: unknown, id: string): AnswerPage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const forTitle = typeof record.for_title === "string" ? record.for_title : "";
  if (forTitle.trim() === "") return null;
  if (!Array.isArray(record.answers)) return null;

  const answers: AnswerPage["answers"] = [];
  for (const entry of record.answers) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const answerRecord = entry as Record<string, unknown>;

    const qnum = Number(answerRecord.qnum);
    if (!Number.isInteger(qnum) || qnum <= 0) continue;

    // Models write a single answer as a string about as often as an array.
    const rawAnswer = answerRecord.answer;
    const values = Array.isArray(rawAnswer)
      ? rawAnswer.filter((a): a is string => typeof a === "string")
      : typeof rawAnswer === "string"
        ? [rawAnswer]
        : [];
    if (values.length === 0) continue;

    answers.push({ qnum, answer: values });
  }

  return answers.length > 0 ? { id, for_title: forTitle, answers } : null;
}

/** Only the shape is coerced here; content is passed through untouched. */
function toQuestion(raw: unknown): SeedQuestion | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const qnum = Number(record.qnum);
  if (!Number.isInteger(qnum) || qnum <= 0) return null;
  if (typeof record.prompt !== "string" || record.prompt.trim() === "") return null;
  if (typeof record.qtype !== "string") return null;

  const options = Array.isArray(record.options)
    ? record.options.filter((o): o is string => typeof o === "string")
    : null;
  const answerKey = Array.isArray(record.answer_key)
    ? record.answer_key.filter((k): k is string => typeof k === "string")
    : [];

  return {
    qnum,
    qtype: record.qtype as SeedQuestion["qtype"],
    prompt: record.prompt,
    options: options && options.length > 0 ? options : null,
    answer_key: answerKey,
    explanation_md:
      typeof record.explanation_md === "string" && record.explanation_md.trim() !== ""
        ? record.explanation_md
        : null,
  };
}

/** Reads one vision response into fragments and answer pages. */
function absorbChunk(
  result: ChunkResult,
  chunkIndex: number,
  fragments: Fragment[],
  answerPages: AnswerPage[],
): { fragmentCount: number; answerPageCount: number } {
  const parsed = Array.isArray(result.fragments) ? result.fragments : [];
  parsed.forEach((fragment, i) => {
    fragments.push({
      id: `c${chunkIndex}f${i + 1}`,
      title: typeof fragment.title === "string" ? fragment.title : "",
      skill: typeof fragment.skill === "string" ? fragment.skill : "reading",
      task_type: typeof fragment.task_type === "string" ? fragment.task_type : "",
      passage_md: typeof fragment.passage_md === "string" ? fragment.passage_md : null,
      transcript_md:
        typeof fragment.transcript_md === "string" ? fragment.transcript_md : null,
      questions: Array.isArray(fragment.questions) ? fragment.questions : [],
      continues_previous: fragment.continues_previous === true,
      warnings: Array.isArray(fragment.warnings)
        ? fragment.warnings.filter((w): w is string => typeof w === "string")
        : [],
    });
  });

  const parsedAnswerPages = Array.isArray(result.answer_pages) ? result.answer_pages : [];
  let answerPageCount = 0;
  parsedAnswerPages.forEach((raw, i) => {
    const page = toAnswerPage(raw, `c${chunkIndex}a${i + 1}`);
    if (page) {
      answerPages.push(page);
      answerPageCount += 1;
    }
  });

  return { fragmentCount: parsed.length, answerPageCount };
}

/**
 * Recovery for answers pages the model files as ordinary fragments.
 *
 * Observed behaviour: shown a page headed "… (Answers)", the model returns a
 * fragment whose "questions" are really answer-key rows — prompt "7", no
 * options, `answer_key: ["A"]`. The content is transcribed correctly, it is just
 * in the wrong slot, and left there it would collide with the real questions by
 * qnum and be discarded. This moves those fragments into `answerPages` where
 * they belong. It is pure re-filing: no text is altered.
 */
function recoverAnswerFragments(
  fragments: Fragment[],
  answerPages: AnswerPage[],
): { fragments: Fragment[]; recovered: number } {
  const kept: Fragment[] = [];
  let recovered = 0;

  for (const fragment of fragments) {
    const questions = fragment.questions
      .map((q) => toQuestion(q))
      .filter((q): q is SeedQuestion => q !== null);

    const titleSaysAnswers = /\(answers?\)/i.test(fragment.title);
    const hasNoPassage =
      (fragment.passage_md ?? "").trim() === "" &&
      (fragment.transcript_md ?? "").trim() === "";
    // Answer-key rows: a key but no options, and a prompt that is really just
    // the question number rather than a question.
    const looksLikeKeyRows =
      questions.length > 0 &&
      questions.every(
        (q) =>
          q.answer_key.length > 0 &&
          q.options === null &&
          /^\d+\s*[.)&\d\s]*$/.test(q.prompt.trim()),
      );

    if (questions.length > 0 && hasNoPassage && (titleSaysAnswers || looksLikeKeyRows)) {
      answerPages.push({
        id: `${fragment.id}-recovered`,
        for_title: fragment.title,
        answers: questions.map((q) => ({ qnum: q.qnum, answer: q.answer_key })),
      });
      recovered += 1;
      continue;
    }

    kept.push(fragment);
  }

  return { fragments: kept, recovered };
}

/** One test awaiting its printed answer key, recorded during assembly. */
interface PendingAnswers {
  slug: string;
  /** Every heading seen for this test — the merge pass's pick and each part's. */
  titles: string[];
  /** Highest page/chunk this test was transcribed from, for positional matching. */
  lastChunk: number;
  questions: SeedQuestion[];
}

/** Fragment and answer-page ids encode the chunk they came from: `c13f1`, `c14a1`. */
function chunkIndexOf(id: string): number {
  const match = id.match(/^c(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * Attach printed answer keys to the tests they belong to.
 *
 * Two strategies, in order of confidence:
 *  1. **By printed heading.** An answers page headed "… Matching Features
 *     (Answers)" belongs to the task with that heading.
 *  2. **By document position.** Sample books print the key on the page directly
 *     after the task, but the two pages are not always headed the same way — a
 *     passage page may be headed with the passage's own title ("The life and work
 *     of Marie Curie") while its answers page is headed with the task type
 *     ("Identifying Information: True/False/Not Given (Answers)"). So an
 *     unmatched answers page is offered to the nearest preceding test, and is
 *     accepted only if its question numbers actually line up with that test's
 *     unanswered questions. That guard is what stops a mismatched key being
 *     silently pasted onto the wrong task.
 *
 * Every positional match is reported, and so is every label substitution, so the
 * user can see exactly how each key was arrived at before committing.
 *
 * A chunk large enough to hold a task *and* its answers page — which the TEXT
 * path routinely is — lets the transcription pass fill `answer_key` itself. Two
 * things follow, and both are handled below: such a key still needs its printed
 * label dereferenced (pass 0), and it must be checked against the printed
 * answers page rather than trusted (inside `apply`).
 */
function attachAnswers(
  pending: PendingAnswers[],
  answerPages: AnswerPage[],
  warnings: string[],
): void {
  const unused = new Set(answerPages.map((p) => p.id));

  function apply(test: PendingAnswers, page: AnswerPage, how: string): number {
    const printedByQnum = new Map(page.answers.map((a) => [a.qnum, a.answer]));
    let filled = 0;
    let checked = 0;

    for (const question of test.questions) {
      const printed = printedByQnum.get(question.qnum);
      if (!printed || printed.length === 0) continue;

      const resolved = printed.map((p) => resolveAnswer(p, question.options));

      // Already answered by the transcription pass: the printed answers page is
      // the authority (fidelity rule 2), so a disagreement is reported rather
      // than quietly resolved either way. This is what catches a key the model
      // padded out from the passage — "preservation" printed, "preservation of
      // the organism" transcribed.
      if (question.answer_key.length > 0) {
        checked += 1;
        const transcribed = question.answer_key.map(normalizeAnswer).sort().join(" | ");
        const fromPage = resolved.map((r) => normalizeAnswer(r.value)).sort().join(" | ");
        // Fidelity rule 4 asks for one entry per printed alternative, so a key
        // transcribed as ["two to five", "2-5"] is the *correct* rendering of a
        // page that prints "two to five / 2-5". Recognising that exact relation
        // keeps the rule working as designed instead of reporting it as drift.
        const fromPageSplit = isChoiceLike(question.qtype)
          ? fromPage
          : resolved
              .flatMap((r) => r.value.split("/"))
              .map(normalizeAnswer)
              .filter((v) => v !== "")
              .sort()
              .join(" | ");
        if (transcribed !== fromPage && transcribed !== fromPageSplit) {
          warnings.push(
            `${test.slug} q${question.qnum}: the transcribed answer key ` +
              `${JSON.stringify(question.answer_key)} does not match the printed answers page, ` +
              `which gives ${JSON.stringify(resolved.map((r) => r.value))}. The printed key is ` +
              "the authority — check the source and correct the staged JSON before committing.",
          );
        }
        continue;
      }

      question.answer_key = resolved.map((r) => r.value);
      filled += 1;

      const substitutions = resolved.filter((r) => r.resolvedFrom !== null);
      if (substitutions.length > 0) {
        warnings.push(
          `${test.slug} q${question.qnum}: the answer key printed ` +
            `${substitutions.map((r) => JSON.stringify(r.resolvedFrom)).join(", ")}, ` +
            `matched to the option(s) ` +
            `${substitutions.map((r) => JSON.stringify(r.value)).join(", ")} by their printed label.`,
        );
      }
    }

    if (filled + checked > 0) {
      unused.delete(page.id);
      if (filled > 0 && how !== "title") warnings.push(`${test.slug}: ${how}`);
    }
    return filled;
  }

  // Pass 0 — dereference printed labels in keys the transcription pass filled
  // in itself. `attachAnswers` already does this for keys it fills from an
  // answers page; a key that arrived with the question needs exactly the same
  // treatment, or a choice question ends up keyed "A" while its options read
  // "A the Chinese" — which the grader would mark every correct answer wrong
  // for, and which the hard validator rejects at commit time.
  for (const test of pending) {
    for (const question of test.questions) {
      if (question.answer_key.length === 0 || question.options === null) continue;

      const resolved = question.answer_key.map((k) => resolveAnswer(k, question.options));
      const substitutions = resolved.filter((r) => r.resolvedFrom !== null);
      if (substitutions.length === 0) continue;

      question.answer_key = resolved.map((r) => r.value);
      warnings.push(
        `${test.slug} q${question.qnum}: the transcribed answer key gave ` +
          `${substitutions.map((r) => JSON.stringify(r.resolvedFrom)).join(", ")}, ` +
          `matched to the option(s) ` +
          `${substitutions.map((r) => JSON.stringify(r.value)).join(", ")} by their printed label.`,
      );
    }
  }

  // Pass 1 — printed heading.
  for (const test of pending) {
    const wanted = new Set(test.titles.map(titleKey).filter((t) => t !== ""));
    for (const page of answerPages) {
      const key = titleKey(page.for_title);
      if (key !== "" && wanted.has(key)) apply(test, page, "title");
    }
  }

  // Pass 2 — nearest preceding test, guarded by question numbers.
  for (const page of answerPages) {
    if (!unused.has(page.id)) continue;

    const pageChunk = chunkIndexOf(page.id);
    const candidates = pending
      .filter((t) => t.lastChunk <= pageChunk && t.questions.some((q) => q.answer_key.length === 0))
      .sort((a, b) => b.lastChunk - a.lastChunk);
    if (candidates.length === 0) continue;

    const test = candidates[0];
    const answerNums = new Set(page.answers.map((a) => a.qnum));
    const unanswered = test.questions.filter((q) => q.answer_key.length === 0);
    const covered = unanswered.filter((q) => answerNums.has(q.qnum)).length;

    // Require the key to cover every question still missing one. A partial
    // overlap is more likely a coincidence of restarted numbering than a match.
    if (covered !== unanswered.length) continue;

    apply(
      test,
      page,
      `answer key matched by document position, not by heading — the key is printed ` +
        `under "${page.for_title}" while this test is titled "${test.titles[0]}". ` +
        `Question numbers ${[...answerNums].sort((a, b) => a - b).join(", ")} line up. Verify it is the right key.`,
    );
  }

  // Pass 3 — report what is left.
  for (const test of pending) {
    const missing = test.questions.filter((q) => q.answer_key.length === 0);
    if (missing.length > 0) {
      warnings.push(
        `${test.slug}: no printed answer was found for question(s) ` +
          `${missing.map((q) => q.qnum).join(", ")} — they cannot be committed until this is fixed.`,
      );
    }

    splitPrintedAlternatives(test, warnings);

    // "Choose TWO letters" tasks print one key for a pair of questions
    // ("1&2 IN EITHER ORDER: B, G"). There is no multi-select qtype in the
    // schema, so that arrives as the same two-entry key on both questions —
    // which the grader would accept twice over, scoring "B" for both as 2/2.
    // The content cannot be represented faithfully; say so rather than commit it.
    const shared = new Map<string, number[]>();
    for (const q of test.questions) {
      // Choice questions only. Since Phase 04 a gap_fill key legitimately holds
      // several entries — one per printed slash-separated variant — and two
      // questions sharing a set of accepted spellings is unremarkable, so
      // fingerprinting those would raise a false multi-select alarm.
      if (!isChoiceLike(q.qtype)) continue;
      if (q.answer_key.length < 2) continue;
      const fingerprint = [...q.answer_key].map(normalizeAnswer).sort().join(" | ");
      shared.set(fingerprint, [...(shared.get(fingerprint) ?? []), q.qnum]);
    }
    for (const [, qnums] of shared) {
      if (qnums.length > 1) {
        warnings.push(
          `${test.slug}: question(s) ${qnums.join(", ")} all carry the SAME multi-answer key. ` +
            "This is the printed \"choose TWO letters … IN EITHER ORDER\" format, where the " +
            "key covers the pair jointly. The schema has no multi-select question type, so " +
            "each question would separately accept either answer — giving the same letter " +
            "twice would score full marks. Do not commit this test as a graded set; drop it " +
            "or rewrite it by hand.",
        );
      }
    }

    if (test.questions.every((q) => q.explanation_md === null)) {
      warnings.push(
        `${test.slug}: no question has an explanation. The passage and the questions were ` +
          "transcribed in separate page chunks, so the model had nothing to ground one in. " +
          "The test still grades correctly; the Review step just shows no explanation.",
      );
    }
  }

  for (const page of answerPages) {
    if (unused.has(page.id)) {
      warnings.push(
        `An answers page headed "${page.for_title}" (${page.answers.length} answer(s)) ` +
          "did not match any test and was not applied.",
      );
    }
  }
}

/** Choice questions answer with one of the printed options, so a "/" in the key
 *  is part of that option's text rather than an alternatives separator. */
function isChoiceLike(qtype: SeedQuestion["qtype"]): boolean {
  return ["mcq", "tfng", "ynng", "matching"].includes(qtype);
}

/**
 * Split every printed `X/Y` key on this test into one `answer_key` entry per
 * variant, and report both what was split and what was deliberately left alone.
 *
 * The judgement lives in `scripts/lib/answer_variants.ts` (pure, fixture-tested
 * by `scripts/check_split.ts`); this function is the part that knows about
 * questions. Choice questions are excluded outright — their key must stay
 * verbatim equal to one of the printed options, where a slash belongs to the
 * option's own text.
 */
function splitPrintedAlternatives(test: PendingAnswers, warnings: string[]): void {
  const limit =
    detectWordLimit(test.questions.map((q) => q.prompt)) ?? DEFAULT_SPLIT_WORD_LIMIT;

  for (const question of test.questions) {
    if (isChoiceLike(question.qtype)) continue;
    if (!question.answer_key.some((key) => key.includes("/"))) continue;

    const split: string[] = [];
    const refused: Array<{ key: string; reason: string }> = [];
    const performed: Array<{ key: string; parts: string[] }> = [];

    for (const key of question.answer_key) {
      const outcome = splitPrintedKey(key, limit);
      split.push(...outcome.parts);

      if (!key.includes("/")) continue;
      if (outcome.refused !== null) {
        refused.push({ key, reason: outcome.refused });
      } else {
        performed.push({ key, parts: outcome.parts });
      }
    }

    // De-duplicate under the grader's own rule: two variants that normalize the
    // same are one accepted answer, and a repeated entry changes nothing.
    const seen = new Set<string>();
    question.answer_key = split.filter((entry) => {
      const normalized = normalizeAnswer(entry);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    for (const { key, parts } of performed) {
      warnings.push(
        `${test.slug} q${question.qnum}: the printed answer key ${JSON.stringify(key)} ` +
          `separates alternatives with a slash and was split into ` +
          `${parts.map((p) => JSON.stringify(p)).join(", ")} — one entry per variant, ` +
          "so each is accepted on its own (mechanical normalization, no wording changed).",
      );
    }
    for (const { key, reason } of refused) {
      warnings.push(
        `${test.slug} q${question.qnum}: the answer key ${JSON.stringify(key)} contains "/" ` +
          `but was NOT split, because ${reason}. Only the combined string will be marked ` +
          "correct — check the source and edit the staged JSON by hand if that is wrong.",
      );
    }
  }
}

/** Title comparison for matching an answers page to its task. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(answers?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The printed label of an option, e.g. "A the Chinese" → "a", "iii Foo" → "iii". */
function optionLabel(option: string): string | null {
  const match = option.trim().match(/^([A-Za-z]|[ivxIVX]+)[).\s]/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Resolve one printed answer against a question's options.
 *
 * An answers page often prints only the label ("7  A") while the options page
 * prints the label with its text ("A  the Chinese"). Grading compares the
 * submitted answer with `answer_key`, and the validator requires a choice key
 * to be one of `options`, so the printed cross-reference has to be followed to
 * the option it points at. This dereferences it — mechanically, never
 * inventing: if no option carries that label the printed answer is kept
 * verbatim, and every substitution is reported so the user sees it in
 * review.md before committing.
 */
function resolveAnswer(
  printed: string,
  options: string[] | null,
): { value: string; resolvedFrom: string | null } {
  const trimmed = printed.trim();
  if (options === null || options.length === 0) {
    return { value: trimmed, resolvedFrom: null };
  }

  // Already a verbatim option — nothing to do.
  const normalized = normalizeAnswer(trimmed);
  const direct = options.find((o) => normalizeAnswer(o) === normalized);
  if (direct) return { value: direct, resolvedFrom: null };

  // A bare label: "A", "iii", "B)".
  const bare = trimmed.match(/^([A-Za-z]|[ivxIVX]+)[).]?$/);
  if (bare) {
    const label = bare[1].toLowerCase();
    const byLabel = options.find((o) => optionLabel(o) === label);
    if (byLabel) return { value: byLabel, resolvedFrom: trimmed };
  }

  // A label followed by the option text, as some keys print it
  // ("A ■ abolishing pay schemes"): match on the label alone.
  const labelled = trimmed.match(/^([A-Za-z]|[ivxIVX]+)[).\s]/);
  if (labelled) {
    const label = labelled[1].toLowerCase();
    const byLabel = options.find((o) => optionLabel(o) === label);
    if (byLabel) return { value: byLabel, resolvedFrom: trimmed };
  }

  return { value: trimmed, resolvedFrom: null };
}

/**
 * Audio pairing, in the order the task file specifies:
 *   <basename>-s<N>.mp3 → that section; else <basename>.mp3 → every section;
 *   else null + a warning (listening only).
 */
function findAudio(base: string, slug: string): string | null {
  const sectionMatch = slug.match(/-s(\d+)$/);
  if (sectionMatch) {
    const perSection = `${base}-s${sectionMatch[1]}.mp3`;
    if (existsSync(join(RAW_DIR, perSection))) return perSection;
  }
  const shared = `${base}.mp3`;
  if (existsSync(join(RAW_DIR, shared))) return shared;
  return null;
}

/**
 * Deterministic repair of the merge plan: honour `continues_previous`.
 *
 * A task that straddles a chunk boundary is transcribed as two fragments, and
 * the transcription pass marks the second one `continues_previous: true`. The
 * merge prompt's first rule says such a fragment belongs to the same test as
 * the one before it — but the merge pass is an LLM call, and it has been
 * observed to ignore its own rule and emit the two halves as separate tests:
 * one with the questions and no passage, one with the passage and a second
 * (option-less) copy of the questions. Neither half is committable.
 *
 * So the rule is enforced here instead, where it cannot be forgotten. The
 * guard is strict title equality, because the failure mode Phase 03 warned
 * about — `continues_previous` staying true straight across a task boundary and
 * fusing two unrelated tasks — always shows up as two different printed titles.
 * Question numbers deliberately do NOT guard this: a re-transcribed task
 * repeats its own numbers, and `assemble` de-duplicates them.
 */
function joinContinuations(
  fragments: Fragment[],
  plan: MergePlan,
  warnings: string[],
): MergePlan {
  const position = new Map(fragments.map((f, i) => [f.id, i]));
  const entries = plan.tests.map((t) => ({ ...t, fragment_ids: [...t.fragment_ids] }));

  const entryOf = (id: string): number =>
    entries.findIndex((e) => e.fragment_ids.includes(id));

  for (let i = 1; i < fragments.length; i += 1) {
    const fragment = fragments[i];
    if (!fragment.continues_previous) continue;

    const previous = fragments[i - 1];
    const key = titleKey(fragment.title);
    if (key === "" || key !== titleKey(previous.title)) continue;

    const here = entryOf(fragment.id);
    const there = entryOf(previous.id);
    if (here === -1 || there === -1 || here === there) continue;

    // Only fold in an entry this fragment *starts*; folding from the middle
    // would silently reorder someone else's test.
    if (entries[here].fragment_ids[0] !== fragment.id) continue;

    entries[there].fragment_ids.push(...entries[here].fragment_ids);
    entries[there].fragment_ids.sort(
      (a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0),
    );
    if (entries[here].title.length > entries[there].title.length) {
      entries[there].title = entries[here].title;
    }
    warnings.push(
      `The merge pass split "${fragment.title}" across a chunk boundary into two tests; ` +
        `fragment ${fragment.id} was marked as continuing ${previous.id} and carries the same ` +
        "printed title, so the two were joined back into one test. Check that the passage and " +
        "its questions belong together.",
    );
    entries.splice(here, 1);
  }

  return { tests: entries, warnings: plan.warnings };
}

function assemble(
  base: string,
  source: string,
  fragments: Fragment[],
  answerPages: AnswerPage[],
  plan: MergePlan,
): StagedFile {
  const byId = new Map(fragments.map((f) => [f.id, f]));
  const warnings: string[] = [...plan.warnings];
  const repaired = joinContinuations(fragments, plan, warnings);
  const used = new Set<string>();
  const tests: StagedTest[] = [];
  const pending: PendingAnswers[] = [];

  let readingIndex = 0;
  let listeningIndex = 0;

  for (const entry of repaired.tests) {
    const parts = entry.fragment_ids
      .map((id) => {
        const fragment = byId.get(id);
        if (!fragment) warnings.push(`Merge plan references unknown fragment "${id}".`);
        return fragment;
      })
      .filter((f): f is Fragment => f !== undefined);

    if (parts.length === 0) continue;
    parts.forEach((f) => used.add(f.id));

    const skill = toTestSkill(entry.skill || parts[0].skill);
    const label = entry.title || parts[0].title || parts[0].id;

    // Concatenation, not regeneration — the transcribed text is preserved byte
    // for byte from the transcription pass.
    const passage = parts
      .map((f) => f.passage_md)
      .filter((p): p is string => typeof p === "string" && p.trim() !== "")
      .join("\n\n");
    const transcript = parts
      .map((f) => f.transcript_md)
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .join("\n\n");

    const questions: SeedQuestion[] = [];
    const seenQnum = new Set<number>();
    // Held until the slug is known, which only happens once we know this entry
    // actually becomes a test.
    const testWarnings: string[] = [];
    for (const fragment of parts) {
      for (const raw of fragment.questions) {
        const question = toQuestion(raw);
        if (!question) {
          testWarnings.push(`dropped a malformed question object from ${fragment.id}.`);
          continue;
        }
        if (seenQnum.has(question.qnum)) {
          // Normal when a task straddles a chunk boundary and gets transcribed
          // twice: the first copy is the one that came with its options.
          testWarnings.push(`duplicate qnum ${question.qnum} across fragments — kept the first.`);
          continue;
        }
        seenQnum.add(question.qnum);
        questions.push(question);
      }
      for (const w of fragment.warnings) testWarnings.push(w);
    }

    if (questions.length === 0) {
      warnings.push(
        `"${label}" produced no questions and was left out of the staged file.`,
      );
      continue;
    }
    questions.sort((a, b) => a.qnum - b.qnum);

    // The slug index is assigned only now, so it counts tests that are actually
    // staged. Numbering an entry that turns out to have no questions would leave
    // a hole in the sequence, and the locked convention is "-p<N> by order of
    // appearance" — something that never appears must not consume an N.
    const index = skill === "listening" ? (listeningIndex += 1) : (readingIndex += 1);
    const slug = `${base}-${skill === "listening" ? "s" : "p"}${index}`;
    for (const w of testWarnings) warnings.push(`${slug}: ${w}`);

    // Answers are attached in a second pass, once every test is known — see
    // `attachAnswers`. Record what this test needs to be matched against.
    pending.push({
      slug,
      titles: [entry.title, ...parts.map((p) => p.title)],
      lastChunk: Math.max(...parts.map((f) => chunkIndexOf(f.id))),
      questions,
    });

    const audioFile = skill === "listening" ? findAudio(base, slug) : null;
    if (skill === "listening" && audioFile === null) {
      warnings.push(
        `${slug} is a listening test but no audio was found — expected ` +
          `content/raw/${base}-s${index}.mp3 or content/raw/${base}.mp3.`,
      );
    }

    tests.push({
      slug,
      skill,
      title: label,
      duration_minutes: DEFAULT_DURATION[skill === "listening" ? "listening" : "reading"],
      audio_file: audioFile,
      content: {
        passage_md: passage === "" ? null : passage,
        transcript_md: transcript === "" ? null : transcript,
      },
      questions,
    });
  }

  // Answer keys are attached only now, with every test's page range known, so an
  // unmatched key can fall back to the task it was printed after.
  attachAnswers(pending, answerPages, warnings);

  for (const fragment of fragments) {
    if (!used.has(fragment.id)) {
      warnings.push(
        `Fragment ${fragment.id} ("${fragment.title}") was not placed in any test by the merge pass.`,
      );
    }
  }

  return {
    source,
    extracted_at: new Date().toISOString(),
    tests,
    warnings,
  };
}

// --- review file -------------------------------------------------------------

function reviewMarkdown(
  file: StagedFile,
  extraWarnings: string[],
  pathNote: string,
): string {
  const lines: string[] = [];
  lines.push(`# Ingestion review — ${file.source}`);
  lines.push("");
  lines.push(`Extracted: ${file.extracted_at}`);
  lines.push("");
  lines.push(pathNote);
  lines.push("");
  lines.push(`Vision calls made in this run: **${visionCallCount}**.`);
  lines.push("");
  lines.push(
    "Nothing here is in the database yet. Read the answer keys below, then run " +
      "`npx tsx scripts/ingest_commit.ts content/staged/<file>.json` to commit.",
  );
  lines.push("");
  lines.push(`**${file.tests.length} test(s) staged.**`);
  lines.push("");

  for (const test of file.tests) {
    const byType = new Map<string, number>();
    for (const q of test.questions) {
      byType.set(q.qtype, (byType.get(q.qtype) ?? 0) + 1);
    }

    lines.push(`## \`${test.slug}\` — ${test.title}`);
    lines.push("");
    lines.push(
      `- Skill: **${test.skill}** · Duration: **${test.duration_minutes} min** · ` +
        `Questions: **${test.questions.length}**`,
    );
    lines.push(
      `- Question types: ${[...byType.entries()]
        .map(([type, count]) => `${type} × ${count}`)
        .join(", ")}`,
    );
    lines.push(
      `- Passage: ${
        test.content.passage_md
          ? `${test.content.passage_md.length} characters`
          : "**none extracted**"
      }` + (test.audio_file ? ` · Audio: \`${test.audio_file}\`` : ""),
    );
    lines.push("");
    lines.push("| # | Type | Answer key | Options | Explained |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const q of test.questions) {
      const key =
        q.answer_key.length === 0
          ? "**MISSING**"
          : q.answer_key.map((k) => `\`${k.replace(/\|/g, "\\|")}\``).join(" · ");
      const options =
        q.options === null
          ? "—"
          : q.options.map((o) => o.replace(/\|/g, "\\|")).join(" / ");
      lines.push(
        `| ${q.qnum} | ${q.qtype} | ${key} | ${options.slice(0, 90)} | ${
          q.explanation_md ? "yes" : "no"
        } |`,
      );
    }
    lines.push("");
  }

  const allWarnings = [...file.warnings, ...extraWarnings];
  lines.push(`## Warnings (${allWarnings.length})`);
  lines.push("");
  if (allWarnings.length === 0) {
    lines.push("None.");
  } else {
    for (const warning of allWarnings) lines.push(`- ${warning}`);
  }
  lines.push("");

  return lines.join("\n");
}

// --- per-PDF pipeline --------------------------------------------------------

/**
 * Vision calls made in this process. Zero is the expected number for any
 * born-digital source; it is printed at the end of a run and recorded in
 * review.md so "did this really avoid vision?" is answerable after the fact.
 */
let visionCallCount = 0;

/** Routes one PDF to the TEXT or the VISION path, on the text-layer verdict. */
async function ingestPdf(
  pdfPath: string,
  resume: boolean,
  noMerge: boolean,
): Promise<void> {
  const base = slugifyBase(basename(pdfPath, extname(pdfPath)));
  const source = basename(pdfPath);
  const logDir = join(LOG_DIR, base);
  mkdirSync(logDir, { recursive: true });

  console.log(`\n▸ ${source}`);

  const pageTexts = extractPageTexts(pdfPath);
  const verdict = detectTextLayer(pdfPath, pageTexts.length);
  const pathNote = pathNoteFor(verdict);
  console.log(`  ${pathNote}`);

  if (verdict.usesText) {
    await ingestViaText(base, source, pageTexts, logDir, resume, noMerge, pathNote);
  } else {
    await ingestViaVision(base, source, pdfPath, logDir, resume, noMerge, pathNote);
  }
}

/**
 * TEXT path: the PDF's own text layer, five pages per `textChat` call.
 *
 * No images means no vision model, no per-request image cap and no
 * tokens-per-minute wall, so a 46-page source goes through in one run. It is
 * also strictly more faithful than vision — this is the publisher's own text,
 * not a model's reading of a rendered image of it.
 */
async function ingestViaText(
  base: string,
  source: string,
  pageTexts: string[],
  logDir: string,
  resume: boolean,
  noMerge: boolean,
  pathNote: string,
): Promise<void> {
  const { textChat, parseModelJson } = await import("../src/lib/ai");

  const fragments: Fragment[] = [];
  const answerPages: AnswerPage[] = [];
  const chunkWarnings: string[] = [];
  let carry: string | null = null;

  /** Log name for one page span. Page-based, so a split retry cannot collide. */
  const spanLog = (first: number, last: number, failed = false): string =>
    join(
      logDir,
      `${failed ? "failed-" : ""}text-p${String(first).padStart(3, "0")}-p${String(last).padStart(3, "0")}.txt`,
    );

  /**
   * Transcribe one span, halving it and retrying if the call fails or the
   * response comes back unparseable — which on this path usually means the
   * completion was truncated because the span was too long to transcribe in one
   * reply. Recursion bottoms out at a single page: that page gets one more
   * attempt (providers do return the occasional empty completion), and if it
   * still fails it is reported in review.md and the run carries on. Losing one
   * page to a warning is far better than losing the other forty-five.
   */
  async function transcribeSpan(first: number, last: number): Promise<void> {
    const logPath = spanLog(first, last);
    process.stdout.write(`  pages ${first}–${last} of ${pageTexts.length} … `);

    const split = async (reason: string): Promise<void> => {
      const mid = first + Math.floor((last - first) / 2);
      console.log(`${reason} — splitting`);
      await transcribeSpan(first, mid);
      await transcribeSpan(mid + 1, last);
    };

    let raw: string;
    if (resume && existsSync(logPath)) {
      raw = readFileSync(logPath, "utf8");
      process.stdout.write("cached … ");
    } else {
      const prompt = extractionPrompt(
        "text",
        first,
        last,
        pageTexts.length,
        carry,
        pageTexts.slice(first - 1, last).join("\n\n"),
      );
      const call = (): Promise<string> =>
        textChat(prompt, { maxCompletionTokens: TEXT_MAX_COMPLETION_TOKENS });

      try {
        raw = await call();
      } catch (err) {
        const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
        if (last > first) {
          await split(`failed (${reason})`);
          return;
        }
        try {
          process.stdout.write(`failed (${reason}) — retrying … `);
          raw = await call();
        } catch (retryErr) {
          const retryReason =
            retryErr instanceof Error ? retryErr.message.split("\n")[0] : String(retryErr);
          chunkWarnings.push(
            `Page ${first} could not be transcribed (${retryReason}) and is MISSING from ` +
              "this extraction. Re-run with --force --resume to retry just that page.",
          );
          console.log(`failed again (${retryReason})`);
          return;
        }
      }
      writeFileSync(logPath, raw);
    }

    let result: ChunkResult;
    try {
      result = parseModelJson<ChunkResult>(raw);
    } catch (err) {
      const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
      if (last > first) {
        // Keep the response for debugging, but under a name --from-logs ignores.
        renameSync(logPath, spanLog(first, last, true));
        await split(`unparseable (${reason})`);
        return;
      }
      chunkWarnings.push(
        `Page ${first} returned unparseable JSON and was skipped. ` +
          `Raw response: content/staged/logs/${base}/${basename(logPath)}`,
      );
      console.log(`unparseable (${reason})`);
      return;
    }

    // The chunk index is the span's first page, so fragment ids stay in document
    // order however the spans were split.
    const { fragmentCount, answerPageCount } = absorbChunk(
      result,
      first,
      fragments,
      answerPages,
    );

    if (Array.isArray(result.warnings)) {
      for (const w of result.warnings) {
        if (typeof w === "string") chunkWarnings.push(`pages ${first}–${last}: ${w}`);
      }
    }

    const lastFragment = fragmentCount > 0 ? fragments[fragments.length - 1] : null;
    carry = lastFragment
      ? `title: ${lastFragment.title}\ntask_type: ${lastFragment.task_type}\n` +
        `questions so far: ${lastFragment.questions.length}\n` +
        `passage tail: …${(lastFragment.passage_md ?? "").slice(-300)}`
      : carry;

    console.log(
      `${fragmentCount} fragment(s)` +
        (answerPageCount > 0 ? `, ${answerPageCount} answer page(s)` : ""),
    );
  }

  for (let start = 0; start < pageTexts.length; start += TEXT_PAGES_PER_CHUNK) {
    const first = start + 1;
    const last = Math.min(start + TEXT_PAGES_PER_CHUNK, pageTexts.length);
    await transcribeSpan(first, last);
  }

  await finishIngest(
    base,
    source,
    fragments,
    answerPages,
    chunkWarnings,
    logDir,
    noMerge,
    pathNote,
  );
}

/** VISION path: unchanged from Phase 03, for sources with no usable text layer. */
async function ingestViaVision(
  base: string,
  source: string,
  pdfPath: string,
  logDir: string,
  resume: boolean,
  noMerge: boolean,
  pathNote: string,
): Promise<void> {
  const { dir, pages } = renderPages(pdfPath);

  try {
    // Dynamic: a static import would evaluate config.ts (which reads
    // process.env at module scope) before `loadEnvFile` above has run.
    const { visionChat, parseModelJson, MAX_IMAGES_PER_CALL } =
      await import("../src/lib/ai");
    // One page = one image, so the chunk size is bounded by the provider's
    // image limit and by what fits in a rate-limit window.
    const pagesPerChunk = Math.min(MAX_IMAGES_PER_CALL, MAX_PAGES_PER_CHUNK);

    const fragments: Fragment[] = [];
    const answerPages: AnswerPage[] = [];
    const chunkWarnings: string[] = [];
    let carry: string | null = null;

    for (let start = 0; start < pages.length; start += pagesPerChunk) {
      const slice = pages.slice(start, start + pagesPerChunk);
      const firstPage = start + 1;
      const lastPage = start + slice.length;
      const chunkIndex = Math.floor(start / pagesPerChunk) + 1;

      process.stdout.write(
        `  chunk ${chunkIndex} (pages ${firstPage}–${lastPage} of ${pages.length}) … `,
      );

      // Resume: a page already transcribed in an earlier run is not paid for
      // twice. The vision pass is the slow, rate-limited step, and its response
      // is logged verbatim, so a run interrupted at page 28 of 46 can pick up
      // exactly there.
      const logPath = join(logDir, `chunk-${String(chunkIndex).padStart(3, "0")}.txt`);
      let raw: string;
      if (resume && existsSync(logPath)) {
        raw = readFileSync(logPath, "utf8");
        process.stdout.write("cached … ");
      } else {
        const images = slice.map((p) => readFileSync(p));
        visionCallCount += 1;
        raw = await visionChat(
          extractionPrompt("images", firstPage, lastPage, pages.length, carry, null),
          images,
        );
        writeFileSync(logPath, raw);
      }

      let result: ChunkResult;
      try {
        result = parseModelJson<ChunkResult>(raw);
      } catch (err) {
        // One unparseable chunk must not lose the other nine.
        chunkWarnings.push(
          `Chunk ${chunkIndex} (pages ${firstPage}–${lastPage}) returned unparseable JSON and was skipped. ` +
            `Raw response: content/staged/logs/${base}/chunk-${String(chunkIndex).padStart(3, "0")}.txt`,
        );
        console.log(`unparseable (${err instanceof Error ? err.message.split("\n")[0] : ""})`);
        continue;
      }

      const { fragmentCount, answerPageCount } = absorbChunk(
        result,
        chunkIndex,
        fragments,
        answerPages,
      );

      if (Array.isArray(result.warnings)) {
        for (const w of result.warnings) {
          if (typeof w === "string") chunkWarnings.push(`pages ${firstPage}–${lastPage}: ${w}`);
        }
      }

      // Continuation context for the next chunk: metadata plus the tail of the
      // last fragment, never the whole transcription.
      const last = fragmentCount > 0 ? fragments[fragments.length - 1] : null;
      carry = last
        ? `title: ${last.title}\ntask_type: ${last.task_type}\nquestions so far: ${last.questions.length}\n` +
          `passage tail: …${(last.passage_md ?? "").slice(-300)}`
        : carry;

      console.log(
        `${fragmentCount} fragment(s)` +
          (answerPageCount > 0 ? `, ${answerPageCount} answer page(s)` : ""),
      );
    }

    await finishIngest(
      base,
      source,
      fragments,
      answerPages,
      chunkWarnings,
      logDir,
      noMerge,
      pathNote,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Merge → assemble → write. Shared by the vision run and the log replay, so
 * both produce a staged file by exactly the same rules.
 */
async function finishIngest(
  base: string,
  source: string,
  fragments: Fragment[],
  answerPages: AnswerPage[],
  chunkWarnings: string[],
  logDir: string,
  noMerge: boolean,
  pathNote: string,
): Promise<void> {
  const { textChat, parseModelJson } = await import("../src/lib/ai");

  if (fragments.length === 0 && answerPages.length === 0) {
    throw new IngestError(
      `No fragments extracted from ${source}. Raw model responses are in content/staged/logs/${base}/.`,
    );
  }

  // Re-file answers pages the model returned as fragments, before the merge
  // pass is asked to group them as if they were tasks.
  const recovery = recoverAnswerFragments(fragments, answerPages);
  if (recovery.recovered > 0) {
    console.log(
      `  recovered ${recovery.recovered} answers page(s) misfiled as fragments`,
    );
  }
  const contentFragments = recovery.fragments;

  if (contentFragments.length === 0) {
    throw new IngestError(
      `${source} produced only answers pages and no questions. Check content/staged/logs/${base}/.`,
    );
  }

  let plan: MergePlan;

  if (noMerge) {
    plan = groupByPrintedTitle(contentFragments);
    console.log(`  grouping by printed title (no merge pass) … ${plan.tests.length} test(s)`);
    chunkWarnings.push(
      "Fragments were grouped deterministically by their printed title instead of by " +
        "the merge pass (--no-merge). Check that no multi-page passage was split and " +
        "that no two different tasks were joined.",
    );
    await writeStaged(
      base,
      source,
      contentFragments,
      answerPages,
      chunkWarnings,
      plan,
      pathNote,
    );
    return;
  }

  process.stdout.write(`  merge pass over ${contentFragments.length} fragments … `);
  const mergeRaw = await textChat(mergePrompt(contentFragments, source));
  writeFileSync(join(logDir, "merge.txt"), mergeRaw);

  try {
    plan = parseModelJson<MergePlan>(mergeRaw);
    if (!Array.isArray(plan.tests)) throw new Error("no `tests` array");
    plan.warnings = Array.isArray(plan.warnings)
      ? plan.warnings.filter((w): w is string => typeof w === "string")
      : [];
  } catch (err) {
    // Fall back to one test per fragment rather than losing the extraction.
    chunkWarnings.push(
      `The merge pass failed (${err instanceof Error ? err.message.split("\n")[0] : String(err)}); ` +
        "each fragment was staged as its own test. Check that multi-page passages are not split.",
    );
    plan = {
      tests: contentFragments.map((f) => ({
        fragment_ids: [f.id],
        title: f.title,
        skill: f.skill,
      })),
      warnings: [],
    };
  }
  console.log(`${plan.tests.length} test(s)`);

  await writeStaged(
    base,
    source,
    contentFragments,
    answerPages,
    chunkWarnings,
    plan,
    pathNote,
  );
}

/**
 * Deterministic grouping, used by --no-merge.
 *
 * Consecutive fragments belong to the same test when they carry the same printed
 * title, or when the model flagged the later one as continuing the earlier. That
 * is the whole of the rule — no model involved, no tokens spent — and for a
 * source that prints a heading on every page it is more reliable than asking.
 */
function groupByPrintedTitle(fragments: Fragment[]): MergePlan {
  const tests: MergePlanEntry[] = [];

  for (const fragment of fragments) {
    const previous = tests[tests.length - 1];
    const previousKey = previous ? titleKey(previous.title) : null;
    const key = titleKey(fragment.title);

    // Only the printed title joins fragments here. `continues_previous` is
    // deliberately NOT trusted: the model reports it against whatever fragment
    // it was shown last, so it stays true straight across a task boundary and
    // fuses unrelated tasks (which then collide on question numbers). The merge
    // pass exists precisely to make that judgement; this fallback does not try.
    const joinsPrevious =
      previous !== undefined && key !== "" && key === previousKey;

    if (joinsPrevious) {
      previous.fragment_ids.push(fragment.id);
      // Prefer the longest printed title seen for the group; a continuation page
      // often repeats the heading in a shortened form.
      if (fragment.title.length > previous.title.length) previous.title = fragment.title;
      continue;
    }

    tests.push({
      fragment_ids: [fragment.id],
      title: fragment.title,
      skill: fragment.skill,
    });
  }

  return { tests, warnings: [] };
}

/** Assemble, validate softly, and write the staged JSON + review.md. */
async function writeStaged(
  base: string,
  source: string,
  contentFragments: Fragment[],
  answerPages: AnswerPage[],
  chunkWarnings: string[],
  plan: MergePlan,
  pathNote: string,
): Promise<void> {
  const staged = assemble(base, source, contentFragments, answerPages, plan);
  staged.warnings = [...chunkWarnings, ...staged.warnings];

  // Soft validation: the point is to *report* rule violations, not to refuse
  // to write the draft. ingest_commit.ts re-runs the same rules hard.
  const { warnings: ruleWarnings } = parseStagedFile(staged, "soft");
  const newRuleWarnings = ruleWarnings.slice(staged.warnings.length);

  const jsonPath = join(STAGED_DIR, `${base}.json`);
  const reviewPath = join(STAGED_DIR, `${base}.review.md`);
  writeFileSync(jsonPath, `${JSON.stringify(staged, null, 2)}\n`);
  writeFileSync(reviewPath, reviewMarkdown(staged, newRuleWarnings, pathNote));

  const questionCount = staged.tests.reduce((n, t) => n + t.questions.length, 0);
  const missingKeys = staged.tests.reduce(
    (n, t) => n + t.questions.filter((q) => q.answer_key.length === 0).length,
    0,
  );

  console.log(
    `  staged ${staged.tests.length} test(s), ${questionCount} question(s)` +
      (missingKeys > 0 ? `, ${missingKeys} WITHOUT an answer key` : "") +
      `\n  → ${jsonPath}\n  → ${reviewPath}`,
  );
  if (staged.warnings.length + newRuleWarnings.length > 0) {
    console.log(
      `  ${staged.warnings.length + newRuleWarnings.length} warning(s) — see the review file.`,
    );
  }
}

/**
 * Re-assemble a staged file from the cached vision responses in
 * `content/staged/logs/<base>/`, with no new page transcriptions.
 *
 * The vision pass is the expensive, slow, rate-limited part and its output is
 * already logged verbatim; the grouping and answer-attachment logic downstream
 * of it is where iteration actually happens. This replays the logs through the
 * current code so that logic can be fixed without re-reading the PDF. Only the
 * merge pass (one cheap text call) runs again.
 */
async function reassembleFromLogs(pdfPath: string, noMerge: boolean): Promise<void> {
  const base = slugifyBase(basename(pdfPath, extname(pdfPath)));
  const source = basename(pdfPath);
  const logDir = join(LOG_DIR, base);

  if (!existsSync(logDir)) {
    throw new IngestError(
      `No cached responses at content/staged/logs/${base}/ — run without --from-logs first.`,
    );
  }

  // A TEXT run's logs are named by page span (`text-p001-p005.txt`) and a VISION
  // run's by chunk number (`chunk-001.txt`). Both may be present — the vision
  // cache from an earlier run is kept rather than deleted — so the newer text
  // logs win, and the two are never mixed: replaying both would stage every page
  // twice. `failed-*` logs are debugging keepsakes and are never replayed.
  const allFiles = readdirSync(logDir).filter(
    (f) => f.endsWith(".txt") && !f.startsWith("failed-"),
  );
  const textFiles = allFiles.filter((f) => f.startsWith("text-p")).sort();
  const visionFiles = allFiles.filter((f) => f.startsWith("chunk-")).sort();
  const usedText = textFiles.length > 0;
  const chunkFiles = usedText ? textFiles : visionFiles;

  if (chunkFiles.length === 0) {
    throw new IngestError(`No chunk logs in content/staged/logs/${base}/.`);
  }

  const pathNote = usedText
    ? `Extraction path: TEXT (replayed from ${chunkFiles.length} cached text-layer ` +
      "response(s)) — no vision calls made, no image/token-per-minute limits apply."
    : `Extraction path: VISION (replayed from ${chunkFiles.length} cached vision ` +
      "response(s)) — the source had no reliable text layer when it was extracted.";

  console.log(`\n▸ ${source} (replaying ${chunkFiles.length} cached chunk response(s))`);
  console.log(`  ${pathNote}`);

  const { parseModelJson } = await import("../src/lib/ai");
  const fragments: Fragment[] = [];
  const answerPages: AnswerPage[] = [];
  const chunkWarnings: string[] = [];

  chunkFiles.forEach((file, i) => {
    // Text logs carry their first page in the name; that is the chunk index the
    // live run used, and answer attachment depends on it ordering correctly.
    const spanMatch = file.match(/^text-p(\d+)/);
    const chunkIndex = spanMatch ? Number(spanMatch[1]) : i + 1;
    const raw = readFileSync(join(logDir, file), "utf8");

    let result: ChunkResult;
    try {
      result = parseModelJson<ChunkResult>(raw);
    } catch {
      chunkWarnings.push(
        `Cached response ${file} is unparseable and was skipped. ` +
          `Re-run without --from-logs to transcribe those pages again.`,
      );
      return;
    }

    absorbChunk(result, chunkIndex, fragments, answerPages);
    if (Array.isArray(result.warnings)) {
      for (const w of result.warnings) {
        if (typeof w === "string") chunkWarnings.push(`${file}: ${w}`);
      }
    }
  });

  await finishIngest(
    base,
    source,
    fragments,
    answerPages,
    chunkWarnings,
    logDir,
    noMerge,
    pathNote,
  );
}

// --- entry point -------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const fromLogs = args.includes("--from-logs");
  const resume = args.includes("--resume");
  const noMerge = args.includes("--no-merge");
  const explicit = args.filter((a) => !a.startsWith("--"));

  await preflight();
  mkdirSync(STAGED_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });

  let targets: string[];
  if (explicit.length > 0) {
    targets = explicit.map((a) => resolve(process.cwd(), a));
    for (const target of targets) {
      if (!existsSync(target)) throw new IngestError(`No such file: ${target}`);
    }
  } else {
    if (!existsSync(RAW_DIR)) {
      throw new IngestError(`content/raw/ does not exist — put source PDFs there first.`);
    }
    targets = readdirSync(RAW_DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort()
      .map((f) => join(RAW_DIR, f));
    if (targets.length === 0) {
      throw new IngestError(`No PDFs in content/raw/ — nothing to ingest.`);
    }
  }

  if (fromLogs) {
    for (const target of targets) {
      await reassembleFromLogs(target, noMerge);
    }
    console.log(
      `\nRe-assembled from cached responses. Review the .review.md file(s), then commit with:\n` +
        `  npx tsx scripts/ingest_commit.ts content/staged/<basename>.json\n`,
    );
    return;
  }

  const skipped: string[] = [];
  const queued = targets.filter((target) => {
    const base = slugifyBase(basename(target, extname(target)));
    const staged = join(STAGED_DIR, `${base}.json`);
    if (!force && existsSync(staged)) {
      skipped.push(`${basename(target)} → content/staged/${base}.json already exists`);
      return false;
    }
    return true;
  });

  for (const line of skipped) console.log(`· skipped: ${line}`);

  if (queued.length === 0) {
    console.log("\nNothing to do. Pass --force to re-extract.");
    return;
  }

  for (const target of queued) {
    await ingestPdf(target, resume, noMerge);
  }

  console.log(
    `\nDone. ${visionCallCount} vision call(s) made. ` +
      `Review the .review.md file(s), then commit with:\n` +
      `  npx tsx scripts/ingest_commit.ts content/staged/<basename>.json\n`,
  );
}

main().catch((err: unknown) => {
  if (err instanceof IngestError || err instanceof ValidationError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
