/**
 * AI essay grading — server / CLI only.
 *
 * One `textChat` call per essay, against the architect's rubric prompt (the
 * Appendix of `tasks/phase_05_writing_ai.md`, reproduced verbatim below). The
 * module is built around four properties:
 *
 *  1. **The overall band is computed in code.** A model asked for five numbers
 *     will happily return an "overall" that is not the mean of the other four,
 *     and the one number the user will quote at themselves is the overall. So
 *     the model is never asked for it: `overallBand` is the mean of TR/CC/LR/GRA
 *     rounded to the nearest half band, here.
 *  2. **The response is validated, not trusted.** Exactly four criteria in
 *     TR/CC/LR/GRA order, every band snapped to a half band inside [0, 9], and
 *     any `improvedSentences` entry whose `original` is not verbatim in the
 *     essay is DROPPED — a rewrite of a sentence the candidate never wrote is
 *     worse than no rewrite at all.
 *  3. **Under 50 words costs nothing.** The refusal happens before the request
 *     is built, so a stray keypress cannot spend tokens from the same daily pool
 *     ingestion draws on.
 *  4. **It writes nothing.** Persistence is `submitEssayAttempt` in
 *     `src/lib/tests.ts`; this module is the model call and the validation.
 *  5. **Evidence outranks the model's own arithmetic (Phase 06).** Rubric v2
 *     makes the model list its errors verbatim before it bands; the quotes are
 *     checked against the essay the same way `improvedSentences` are, and where
 *     the surviving evidence is countable the code applies the cap itself —
 *     three or more real spelling/word-form errors hold Lexical Resource at
 *     6.0 whatever number came back.
 */

import { parseModelJson, textChat } from "@/lib/ai";
import { MIN_ESSAY_WORDS, countWords } from "@/lib/words";

/**
 * Pure, and shared with the browser's live word counter, so both live in
 * `@/lib/words` — this module is server-only and importing it from a client
 * component would drag the AI client into the bundle. Re-exported here because
 * the Phase 05 contract names `countWords` as part of this module's surface.
 */
export { countWords, MIN_ESSAY_WORDS };

export const WRITING_TASK_TYPES = ["task1", "task2"] as const;
export type WritingTaskType = (typeof WRITING_TASK_TYPES)[number];

export interface WritingCriterion {
  name: "TR" | "CC" | "LR" | "GRA"; // Task Response/Achievement, Coherence
  band: number; // 0–9 in 0.5 steps
  comment: string; // 2–4 sentences, quotes the essay
  /**
   * The specific errors found for this criterion, quoted VERBATIM from the
   * essay. Rubric v2 (Phase 06): the model lists the evidence before it bands,
   * so a band has something under it that can be checked — by the user reading
   * it and, for LR, by the code below. Anything not literally present in the
   * essay is dropped on the way in, exactly as `improvedSentences` is.
   */
  errors: string[];
  /**
   * True when the code clamped this band rather than the model choosing it.
   * Only LR is clamped mechanically (≥3 surviving errors ⇒ at most 6.0); the
   * other evidence-tied caps are stated in the prompt and are the model's to
   * apply. Shown to the user so a capped band is never silently attributed to
   * the examiner's judgement.
   */
  capped: boolean;
}

export interface WritingFeedback {
  overallBand: number; // computed in CODE: mean of the four,
  // rounded to nearest 0.5 — never
  // trust a model-supplied average
  criteria: WritingCriterion[]; // exactly 4, TR/CC/LR/GRA order
  topFixes: string[]; // 3–5 highest-impact actions
  improvedSentences: Array<{ original: string; improved: string; reason: string }>;
  // ≤3, original must be verbatim from the essay
  lengthNote: string | null; // set when under min_words
}

/** The task a writing test poses, read from `tests.content`. */
export interface EssayTask {
  taskType: WritingTaskType;
  minWords: number;
  promptMd: string;
}

export const CRITERION_ORDER = ["TR", "CC", "LR", "GRA"] as const;

/** Four comments, five fixes and three rewrites fit comfortably; reasoning is off. */
const MAX_COMPLETION_TOKENS = 3_000;

/** The refusal, as its own type so the UI can tell it from a provider failure. */
export class EssayTooShortError extends Error {
  constructor(readonly words: number) {
    super(
      `This response is ${words} word${words === 1 ? "" : "s"} long. ` +
        `Nothing shorter than ${MIN_ESSAY_WORDS} words is sent for feedback — ` +
        "there is not enough writing to grade against the band descriptors.",
    );
    this.name = "EssayTooShortError";
  }
}

/** A response that is not the agreed shape, kept separate so it can be retried. */
export class FeedbackShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackShapeError";
  }
}

// --- reading the task off a test row ----------------------------------------

/** `tests.content` is jsonb, so it is `unknown` until proven otherwise. */
export function readEssayTask(content: unknown): EssayTask | null {
  if (typeof content !== "object" || content === null || Array.isArray(content)) {
    return null;
  }
  const record = content as Record<string, unknown>;

  const taskType = record.task_type;
  const minWords = record.min_words;
  const promptMd = record.prompt_md;

  if (
    typeof taskType !== "string" ||
    !(WRITING_TASK_TYPES as readonly string[]).includes(taskType) ||
    typeof minWords !== "number" ||
    !Number.isInteger(minWords) ||
    minWords <= 0 ||
    typeof promptMd !== "string" ||
    promptMd.trim() === ""
  ) {
    return null;
  }

  return {
    taskType: taskType as WritingTaskType,
    minWords,
    promptMd,
  };
}

// --- band arithmetic ---------------------------------------------------------

/** Snap to a half band and clamp to the descriptor range. */
export function snapBand(value: number): number {
  const snapped = Math.round(value * 2) / 2;
  return Math.min(9, Math.max(0, snapped));
}

/**
 * The overall band, computed here and nowhere else: the arithmetic mean of the
 * four criteria, rounded to the nearest half band. (IELTS rounds .25 up to the
 * next half and .75 up to the next whole; `Math.round` on doubled values does
 * exactly that, because it rounds halves away from zero on positives.)
 */
export function computeOverallBand(criteria: WritingCriterion[]): number {
  if (criteria.length === 0) return 0;
  const mean = criteria.reduce((sum, c) => sum + c.band, 0) / criteria.length;
  return snapBand(mean);
}

// --- response validation -----------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * At most this many quoted errors are kept per criterion. A model that decides
 * to quote every clause in the essay should not turn the review screen into a
 * second copy of it; three is already enough to trigger the LR cap, so the
 * limit cannot make the clamp below more generous than it should be.
 */
const MAX_ERRORS_PER_CRITERION = 10;

/**
 * The evidence filter, and the reason rubric v2 is worth anything: an "error"
 * the candidate did not actually write is a fabrication, and the same argument
 * that drops an invented `improvedSentences.original` drops it here. Exact
 * duplicates collapse — quoting `beleive` three times is one error, not three,
 * and the count below decides a band.
 *
 * Note the consequence for TR: an *unaddressed* part of the task has, by
 * definition, nothing in the essay to quote, so TR's list is usually empty and
 * its comment carries that finding instead. TR's cap is prompt-level, so
 * nothing is lost mechanically.
 */
function filterVerbatimErrors(raw: unknown, essay: string): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const kept: string[] = [];

  for (const entry of raw) {
    const text = asString(entry)?.trim();
    if (text === undefined || text === "") continue;
    if (!essay.includes(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    kept.push(text);
    if (kept.length === MAX_ERRORS_PER_CRITERION) break;
  }

  return kept;
}

/**
 * The one cap code can enforce mechanically (Phase 06 calibration ruling).
 *
 * Three or more spelling / word-form errors that are genuinely in the essay is
 * a countable fact, not a judgement call, and the Lexical Resource descriptor
 * does not survive it above band 6. The model is told the same rule in the
 * rubric; this is what happens when it says 7.0 anyway. The other three caps —
 * CC's mechanical-linker chain, GRA's error density, TR's unaddressed part —
 * need reading comprehension to apply and stay at prompt level.
 */
export const LR_ERROR_CAP_THRESHOLD = 3;
export const LR_ERROR_CAP_BAND = 6.0;

function applyLexicalResourceCap(criterion: WritingCriterion): WritingCriterion {
  if (criterion.name !== "LR") return criterion;
  if (criterion.errors.length < LR_ERROR_CAP_THRESHOLD) return criterion;
  if (criterion.band <= LR_ERROR_CAP_BAND) return criterion;
  return { ...criterion, band: LR_ERROR_CAP_BAND, capped: true };
}

/**
 * Turn whatever the model returned into a `WritingFeedback`, or throw
 * `FeedbackShapeError` naming what was wrong (the message is fed back to the
 * model on the single retry).
 *
 * Exported so `scripts/check_writing.ts` can pin the filters without a
 * provider: this is the part that has to be right even on a bad day.
 */
export function validateFeedback(parsed: unknown, essay: string): WritingFeedback {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FeedbackShapeError("the response is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;

  const rawCriteria = record.criteria;
  if (!Array.isArray(rawCriteria) || rawCriteria.length !== CRITERION_ORDER.length) {
    throw new FeedbackShapeError(
      `"criteria" must be an array of exactly ${CRITERION_ORDER.length} entries, ` +
        `in the order ${CRITERION_ORDER.join(", ")}`,
    );
  }

  const criteria: WritingCriterion[] = rawCriteria.map((raw, i) => {
    const expected = CRITERION_ORDER[i];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new FeedbackShapeError(`criteria[${i}] is not an object`);
    }
    const entry = raw as Record<string, unknown>;

    if (entry.name !== expected) {
      throw new FeedbackShapeError(
        `criteria[${i}].name must be ${JSON.stringify(expected)}, got ${JSON.stringify(entry.name)} ` +
          `— the four criteria must appear in the order ${CRITERION_ORDER.join(", ")}`,
      );
    }

    const band = typeof entry.band === "number" ? entry.band : Number(entry.band);
    if (!Number.isFinite(band)) {
      throw new FeedbackShapeError(
        `criteria[${i}].band must be a number 0-9, got ${JSON.stringify(entry.band)}`,
      );
    }

    const comment = asString(entry.comment);
    if (comment === null) {
      throw new FeedbackShapeError(`criteria[${i}].comment must be a non-empty string`);
    }

    // A missing or malformed `errors` is an empty list, not a shape error: the
    // rubric allows an empty array, and a criterion with genuinely nothing to
    // quote is the good case. Only the quotes that survive the verbatim filter
    // reach the cap below, so an inflated list cannot depress a band either.
    return applyLexicalResourceCap({
      name: expected,
      band: snapBand(band),
      comment,
      errors: filterVerbatimErrors(entry.errors, essay),
      capped: false,
    });
  });

  const topFixes = Array.isArray(record.topFixes)
    ? record.topFixes.map(asString).filter((fix): fix is string => fix !== null)
    : [];
  if (topFixes.length === 0) {
    throw new FeedbackShapeError('"topFixes" must be a non-empty array of strings');
  }

  // The rubric asks for 3-5. More than that is not a shape error worth a retry
  // — it is a model being generous — so the extras are dropped by impact order,
  // which is the order the rubric asked for them in.
  const trimmedFixes = topFixes.slice(0, 5);

  // Anything whose `original` is not verbatim in the essay is dropped rather
  // than shown: a "correction" of a sentence the candidate never wrote teaches
  // the wrong lesson, and is the single most likely way this call goes wrong.
  const improvedSentences = (
    Array.isArray(record.improvedSentences) ? record.improvedSentences : []
  )
    .map((raw) => {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
      const entry = raw as Record<string, unknown>;
      const original = asString(entry.original);
      const improved = asString(entry.improved);
      const reason = asString(entry.reason);
      if (original === null || improved === null || reason === null) return null;
      if (!essay.includes(original.trim())) return null;
      return { original: original.trim(), improved, reason };
    })
    .filter((entry): entry is { original: string; improved: string; reason: string } =>
      entry !== null,
    )
    .slice(0, 3);

  const lengthNote = asString(record.lengthNote);

  return {
    // Never `record.overallBand`, whatever the model sent.
    overallBand: computeOverallBand(criteria),
    criteria,
    topFixes: trimmedFixes,
    improvedSentences,
    lengthNote,
  };
}

// --- the rubric prompt -------------------------------------------------------

/**
 * The architect-authored rubric — Phase 05's Appendix prompt, amended in place
 * by the Phase 06 calibration ruling (`tasks/phase_06_dashboard_deploy.md`,
 * Step 0a). Only the mechanical parts below the rule block are filled in (task
 * type, minimum length, the task and the essay) and the honesty rules are not
 * touched.
 *
 * What v2 changes and why: v1's comments were accurate and its numbers ran a
 * band high — a 286-word essay with misspellings and a mechanical linker chain
 * came back at 7.0. The fix is to make the model find the evidence BEFORE it
 * picks a band (a band chosen first will always find a reason), to name the
 * caps that evidence implies, and to have the code check the one cap that is
 * countable rather than trusting the model to apply it.
 */
const RUBRIC = `You are an experienced IELTS examiner grading one candidate essay. Grade
honestly against the official band descriptors — do NOT inflate. Most essays
from intermediate learners genuinely sit between band 5.0 and 6.5; award 7+
on a criterion only when the descriptor is truly met.

Work in this order, for every criterion: FIRST list the specific evidence you
find in the essay, THEN apply the descriptor to what you listed. Never choose a
band first and look for evidence to justify it afterwards.

Criteria (score each 0-9, half bands allowed):
1. TR — Task Response (Task 2) / Task Achievement (Task 1): Does it address
   ALL parts of the task? Is the position clear and consistent (T2)? Is there
   an overview and are key features selected accurately with data (T1)? An
   under-length response cannot score above 5 here; note it.
   Off-topic or memorised-template content caps TR at 4.
2. CC — Coherence and Cohesion: logical paragraphing (one central idea each),
   natural linking (penalize mechanical overuse of connectors), clear
   progression.
3. LR — Lexical Resource: range AND precision. Reward accurate, natural
   collocation; penalize misused "impressive" words more than plain correct
   ones, and penalize spelling errors that strain reading.
4. GRA — Grammatical Range and Accuracy: variety of structures AND the
   proportion of error-free sentences. Frequent basic errors cap this at 5.5.

Step 1 — the error inventory. For each criterion fill "errors" with the
specific problems you found, each one copied VERBATIM from the candidate essay,
as the shortest span that shows the problem. An empty array is allowed and is
the right answer when you genuinely found none. What belongs in each list:
- TR: nothing, unless a sentence in the essay itself goes off task or is
  template filler — quote that sentence. A part of the task that is simply
  missing has nothing to quote; say so in the comment instead.
- CC: every mechanical or overused connector, quoted ("Firstly,", "Moreover,").
- LR: every spelling error, wrong word form and misused word, quoted exactly as
  the candidate wrote it ("beleive", "more fair").
- GRA: every faulty sentence or clause, quoted.

Step 2 — the caps those lists imply. Apply them AFTER listing, and do not
score above them:
- 3 or more spelling / word-form errors in LR's list → LR is at most 6.0.
- Cohesion carried by a mechanical Firstly / Secondly / Moreover chain →
  CC is at most 6.5.
- Errors in more than roughly a third of the sentences → GRA is at most 6.0.
- Any part of the task left unaddressed → TR is at most 5.0. (An under-length
  response already caps TR at 5.0.)

Rules:
- Everything in "errors" must be a literal substring of the candidate essay.
  Anything that is not is discarded before the candidate sees it, so a quote
  you paraphrase or tidy up is a quote you have thrown away.
- Every criterion comment must quote at least one short phrase from the essay
  as evidence (positive or negative).
- topFixes: the 3-5 changes that would raise the band fastest, concrete and
  actionable, ordered by impact.
- improvedSentences: up to 3. "original" must be copied VERBATIM from the
  essay; "improved" fixes it at the target of band 7, staying in the
  candidate's own register; "reason" names the band criterion it serves.
- Do not rewrite the whole essay. Do not comment on handwriting, timing, or
  anything outside the text. Do not invent content the essay doesn't contain.
- If the essay is under the minimum length, say so plainly in a lengthNote
  and reflect it in TR per the descriptor.
Output JSON only, matching the provided schema exactly. No commentary.`;

const RESPONSE_SCHEMA = `{
  "criteria": [
    {"name": "TR", "errors": [], "band": 0-9, "comment": "2-4 sentences quoting the essay"},
    {"name": "CC", "errors": ["Firstly,", "Moreover,"], "band": 0-9, "comment": "..."},
    {"name": "LR", "errors": ["beleive", "more fair"], "band": 0-9, "comment": "..."},
    {"name": "GRA", "errors": ["..."], "band": 0-9, "comment": "..."}
  ],
  "topFixes": ["...", "...", "..."],
  "improvedSentences": [{"original": "...", "improved": "...", "reason": "..."}],
  "lengthNote": null
}`;

export function buildGradingPrompt(input: {
  taskType: WritingTaskType;
  promptMd: string;
  essay: string;
  minWords: number;
}): string {
  const words = countWords(input.essay);
  const taskLabel = input.taskType === "task1" ? "Task 1" : "Task 2";

  return `${RUBRIC}

TASK: IELTS Academic Writing ${taskLabel}
MINIMUM LENGTH: ${input.minWords} words
LENGTH OF THIS RESPONSE: ${words} words${
    words < input.minWords ? " (UNDER the minimum)" : ""
  }

TASK PROMPT:
${input.promptMd}

CANDIDATE ESSAY:
${input.essay}

Reply with JSON and nothing else, exactly this shape (the four criteria in this
order, "errors" written out before "band" in each one, and no "overall" field —
the overall band is computed from your four scores):
${RESPONSE_SCHEMA}`;
}

// --- the call ----------------------------------------------------------------

export interface GradeEssayOptions {
  /**
   * The model call. Injected by `scripts/check_writing.ts` so the validation,
   * the retry and the band arithmetic can be pinned without spending a token;
   * in the app it is always the real `textChat`.
   */
  chat?: (prompt: string) => Promise<string>;
}

export async function gradeEssay(
  input: {
    taskType: "task1" | "task2";
    promptMd: string;
    essay: string;
    minWords: number;
  },
  options: GradeEssayOptions = {},
): Promise<WritingFeedback> {
  const words = countWords(input.essay);
  // Before anything is built, let alone sent: an under-50-word response costs
  // no tokens. `submitEssayAttempt` refuses first for the same reason; this is
  // the backstop for any other caller.
  if (words < MIN_ESSAY_WORDS) {
    throw new EssayTooShortError(words);
  }

  const chat =
    options.chat ??
    ((prompt: string) =>
      textChat(prompt, { maxCompletionTokens: MAX_COMPLETION_TOKENS }));

  const prompt = buildGradingPrompt({ ...input, taskType: input.taskType });

  let lastProblem = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const request =
      attempt === 1
        ? prompt
        : `${prompt}

Your previous reply could not be used: ${lastProblem}
Reply again with JSON only, matching the schema above exactly.`;

    const raw = await chat(request);

    try {
      return validateFeedback(parseModelJson<unknown>(raw), input.essay);
    } catch (err) {
      // A shape/parse problem is worth exactly one more try, with the reason
      // appended. Anything else (a provider failure) has already been retried
      // inside `ai.ts` and is not this loop's to swallow.
      if (!(err instanceof FeedbackShapeError) && !isJsonParseError(err)) throw err;
      lastProblem = err instanceof Error ? err.message : String(err);
    }
  }

  throw new Error(
    `The grading model did not return usable feedback after two attempts: ${lastProblem}`,
  );
}

/** `parseModelJson` throws a plain Error; this is how we recognise its own. */
function isJsonParseError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("Model did not return valid JSON");
}

// --- storage rendering -------------------------------------------------------

/**
 * The markdown stored in `attempts.ai_feedback_md`.
 *
 * Phase 6 shows attempt history; making it re-parse a JSON blob to print a band
 * and four comments would tie its display to this module's internals forever.
 * Markdown is the interchange format the rest of the app already uses.
 */
export function feedbackToMarkdown(
  feedback: WritingFeedback,
  task: { taskType: WritingTaskType; minWords: number },
): string {
  const CRITERION_LABEL: Record<WritingCriterion["name"], string> = {
    TR: task.taskType === "task1" ? "Task Achievement" : "Task Response",
    CC: "Coherence and Cohesion",
    LR: "Lexical Resource",
    GRA: "Grammatical Range and Accuracy",
  };

  const lines: string[] = [
    `**Overall band ${feedback.overallBand.toFixed(1)}** — AI estimate ±0.5, not an official result.`,
    "",
  ];

  if (feedback.lengthNote !== null) {
    lines.push(`> **Length:** ${feedback.lengthNote}`, "");
  }

  for (const criterion of feedback.criteria) {
    lines.push(
      `### ${criterion.name} — ${CRITERION_LABEL[criterion.name]}: ${criterion.band.toFixed(1)}`,
      "",
      criterion.comment,
      "",
    );

    if (criterion.capped) {
      lines.push(
        `*Capped at ${LR_ERROR_CAP_BAND.toFixed(1)}: ${criterion.errors.length} spelling ` +
          "or word-form errors were found in the essay.*",
        "",
      );
    }

    // The evidence goes into the stored markdown too, not just the live review
    // screen: it is what makes an old band re-checkable months later.
    if (criterion.errors.length > 0) {
      lines.push(`Found in your text (${criterion.errors.length}):`, "");
      for (const error of criterion.errors) {
        lines.push(`- \`${error}\``);
      }
      lines.push("");
    }
  }

  lines.push("### Top fixes", "");
  feedback.topFixes.forEach((fix, i) => lines.push(`${i + 1}. ${fix}`));
  lines.push("");

  if (feedback.improvedSentences.length > 0) {
    lines.push("### Sentences to rewrite", "");
    for (const sentence of feedback.improvedSentences) {
      lines.push(
        `- **You wrote:** ${sentence.original}`,
        `  **Better:** ${sentence.improved}`,
        `  *Why:* ${sentence.reason}`,
        "",
      );
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
