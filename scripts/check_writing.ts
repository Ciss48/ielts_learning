/**
 * Fixture check for the writing core.
 *
 *   npx tsx scripts/check_writing.ts
 *
 * No database, no environment, and — the point of this file — **no live AI**.
 * `gradeEssay` takes an injectable `chat`, so the whole path is exercised here
 * with canned model responses: the happy case, a malformed reply that costs one
 * retry, a reply that never becomes usable, and the refusal that must not reach
 * the provider at all. Everything that decides what the user is shown is pure
 * and is pinned here; the only thing left to a live run is whether the provider
 * answers.
 *
 * Exits 0 on pass, 1 naming every failing case.
 */

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CRITERION_ORDER,
  EssayTooShortError,
  FeedbackShapeError,
  buildGradingPrompt,
  computeOverallBand,
  feedbackToMarkdown,
  gradeEssay,
  readEssayTask,
  snapBand,
  validateFeedback,
  type WritingFeedback,
} from "../src/lib/writing";
import { MIN_ESSAY_WORDS, countWords } from "../src/lib/words";
import { splitMarkdownTables } from "../src/lib/md_tables";
import {
  EssayFeedbackPanel,
  EssayPanel,
  EssayRefusal,
} from "../src/components/session/WritingPanels";
import {
  AiWait,
  EXPLAIN_WAIT,
  GRADING_WAIT,
} from "../src/components/session/PracticePanels";
import type { PlayerEssay, PlayerTest } from "../src/lib/tests";

// tsx compiles a .tsx module with the classic JSX runtime, which emits bare
// `React.createElement` calls and expects `React` to be in scope. Next injects
// that import itself; a plain script has to provide it, and the components must
// not carry a React import purely so a check script can render them.
(globalThis as unknown as { React: typeof React }).React = React;

const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function ok(name: string, condition: boolean, detail: string): void {
  if (!condition) failures.push(`${name}\n    ${detail}`);
}

function throws(name: string, fn: () => unknown, matcher: RegExp): void {
  try {
    fn();
    failures.push(`${name}\n    expected it to throw, it returned normally`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!matcher.test(message)) {
      failures.push(`${name}\n    threw, but the message did not match ${matcher}\n    got: ${message}`);
    }
  }
}

// --- countWords ---------------------------------------------------------------

check("countWords: plain prose", countWords("I went to the shop"), 5);
check("countWords: empty string", countWords(""), 0);
check("countWords: whitespace only", countWords("   \n\t  "), 0);
check("countWords: leading and trailing whitespace", countWords("  one two  "), 2);
check("countWords: newlines and tabs are whitespace", countWords("one\ntwo\tthree"), 3);
check("countWords: a run of spaces is one separator", countWords("one     two"), 2);
// The two rules the contract names explicitly.
check("countWords: a hyphenated word is ONE word", countWords("well-being matters"), 2);
check("countWords: a long hyphenated chain is still one", countWords("state-of-the-art"), 1);
check("countWords: a number is one word", countWords("in 1990 it rose"), 4);
check("countWords: a percentage is one word", countWords("rose to 79%"), 3);
check("countWords: a decimal is one word", countWords("2.5 million"), 2);
// A stray dash or bullet is not a word; that is what "contains a letter or
// digit" buys, and it stops a list of bullets inflating the count.
check("countWords: a lone dash is not a word", countWords("one - two"), 2);
check("countWords: a lone bullet is not a word", countWords("• first point"), 2);
check("countWords: punctuation attaches to its word", countWords("Yes, I agree."), 3);
check("countWords: non-ASCII letters count", countWords("Việt Nam đang phát triển"), 5);

// --- band arithmetic ----------------------------------------------------------

check("snapBand: 6.3 snaps down to 6.5's neighbour", snapBand(6.3), 6.5);
check("snapBand: 6.2 snaps to 6.0", snapBand(6.2), 6.0);
check("snapBand: 6.25 snaps up to 6.5", snapBand(6.25), 6.5);
check("snapBand: a half band is left alone", snapBand(5.5), 5.5);
check("snapBand: clamps above 9", snapBand(11), 9);
check("snapBand: clamps below 0", snapBand(-3), 0);
check("snapBand: 8.9 → 9.0", snapBand(8.9), 9);

function criteria(bands: number[]): WritingFeedback["criteria"] {
  return CRITERION_ORDER.map((name, i) => ({
    name,
    band: bands[i],
    comment: `comment for ${name}`,
    errors: [],
    capped: false,
  }));
}

check("overall: 6+6+6+6 → 6.0", computeOverallBand(criteria([6, 6, 6, 6])), 6.0);
check("overall: 6+6+6+7 → 6.5 (mean 6.25 rounds up)", computeOverallBand(criteria([6, 6, 6, 7])), 6.5);
check("overall: 6+6+6+6.5 → 6.0 (mean 6.125 rounds down)", computeOverallBand(criteria([6, 6, 6, 6.5])), 6.0);
check("overall: 5+6+6+6 → 6.0 (mean 5.75 rounds up)", computeOverallBand(criteria([5, 6, 6, 6])), 6.0);
check("overall: 5+5+6+6 → 5.5", computeOverallBand(criteria([5, 5, 6, 6])), 5.5);
check("overall: 9+9+9+9 → 9.0", computeOverallBand(criteria([9, 9, 9, 9])), 9.0);

// --- validateFeedback ---------------------------------------------------------

const ESSAY =
  "Some people argue that university education should be funded by the state. " +
  "In my opinion, free tuition widens access for talented students from poor families, " +
  "and the cost is repaid many times over in taxes. However, a fully free system is expensive, " +
  "so a means-tested contribution is a fairer compromise. I strongly beleive this balance works best.";

function modelResponse(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    // A model-supplied average, deliberately wrong: it must be ignored.
    overallBand: 9,
    criteria: [
      { name: "TR", band: 6, comment: "You address both views." },
      { name: "CC", band: 6.5, comment: "Paragraphing is clear." },
      { name: "LR", band: 5.5, comment: "'beleive' is misspelled." },
      { name: "GRA", band: 6, comment: "Some good complex sentences." },
    ],
    topFixes: ["Proofread for spelling.", "Add a clearer thesis.", "Vary your linkers."],
    improvedSentences: [
      {
        original: "I strongly beleive this balance works best.",
        improved: "I firmly believe this balance strikes the fairest compromise.",
        reason: "LR — spelling and collocation.",
      },
    ],
    lengthNote: null,
    ...overrides,
  });
}

const valid = validateFeedback(JSON.parse(modelResponse()), ESSAY);
check("validate: four criteria in order", valid.criteria.map((c) => c.name), [
  "TR",
  "CC",
  "LR",
  "GRA",
]);
check(
  "validate: the model's own overall is IGNORED and recomputed",
  valid.overallBand,
  6.0,
);
check("validate: a verbatim improved sentence survives", valid.improvedSentences.length, 1);
check("validate: lengthNote null stays null", valid.lengthNote, null);

// Band snapping happens on the way in, so nothing downstream ever sees 6.3.
const snapped = validateFeedback(
  JSON.parse(
    modelResponse({
      criteria: [
        { name: "TR", band: 6.3, comment: "a" },
        { name: "CC", band: 11, comment: "b" },
        { name: "LR", band: -2, comment: "c" },
        { name: "GRA", band: "6.5", comment: "d" },
      ],
    }),
  ),
  ESSAY,
);
check(
  "validate: every band is snapped and clamped",
  snapped.criteria.map((c) => c.band),
  [6.5, 9, 0, 6.5],
);
check("validate: a numeric string band is accepted once snapped", snapped.criteria[3].band, 6.5);
check("validate: overall follows the snapped bands", snapped.overallBand, 5.5);

// The filter that matters most: a rewrite of a sentence the candidate never
// wrote is dropped, not shown.
const invented = validateFeedback(
  JSON.parse(
    modelResponse({
      improvedSentences: [
        {
          original: "I strongly beleive this balance works best.",
          improved: "I firmly believe this balance is best.",
          reason: "LR",
        },
        {
          original: "Education is the cornerstone of a prosperous society.",
          improved: "Education underpins a prosperous society.",
          reason: "LR",
        },
      ],
    }),
  ),
  ESSAY,
);
check("validate: only the verbatim original survives", invented.improvedSentences.length, 1);
check(
  "validate: and it is the one actually in the essay",
  invented.improvedSentences[0].original,
  "I strongly beleive this balance works best.",
);

const tooMany = validateFeedback(
  JSON.parse(
    modelResponse({
      improvedSentences: [1, 2, 3, 4].map(() => ({
        original: "In my opinion, free tuition widens access",
        improved: "In my view, free tuition broadens access",
        reason: "LR",
      })),
      topFixes: ["a", "b", "c", "d", "e", "f", "g"],
    }),
  ),
  ESSAY,
);
check("validate: improvedSentences is capped at 3", tooMany.improvedSentences.length, 3);
check("validate: topFixes is capped at 5", tooMany.topFixes.length, 5);
check("validate: the fixes kept are the highest-impact ones", tooMany.topFixes, [
  "a",
  "b",
  "c",
  "d",
  "e",
]);

const messyFixes = validateFeedback(
  JSON.parse(modelResponse({ topFixes: ["Proofread.", "", 42, null, "Add a thesis."] })),
  ESSAY,
);
check("validate: non-string fixes are dropped", messyFixes.topFixes, [
  "Proofread.",
  "Add a thesis.",
]);

throws(
  "validate: three criteria is a shape error",
  () =>
    validateFeedback(
      JSON.parse(modelResponse({ criteria: JSON.parse(modelResponse()).criteria.slice(0, 3) })),
      ESSAY,
    ),
  /exactly 4 entries/,
);
throws(
  "validate: criteria out of order is a shape error",
  () =>
    validateFeedback(
      JSON.parse(
        modelResponse({
          criteria: [
            { name: "CC", band: 6, comment: "a" },
            { name: "TR", band: 6, comment: "b" },
            { name: "LR", band: 6, comment: "c" },
            { name: "GRA", band: 6, comment: "d" },
          ],
        }),
      ),
      ESSAY,
    ),
  /criteria\[0\]\.name must be "TR"/,
);
throws(
  "validate: a non-numeric band is a shape error",
  () =>
    validateFeedback(
      JSON.parse(
        modelResponse({
          criteria: [
            { name: "TR", band: "good", comment: "a" },
            { name: "CC", band: 6, comment: "b" },
            { name: "LR", band: 6, comment: "c" },
            { name: "GRA", band: 6, comment: "d" },
          ],
        }),
      ),
      ESSAY,
    ),
  /must be a number 0-9/,
);
throws(
  "validate: an empty comment is a shape error",
  () =>
    validateFeedback(
      JSON.parse(
        modelResponse({
          criteria: [
            { name: "TR", band: 6, comment: "" },
            { name: "CC", band: 6, comment: "b" },
            { name: "LR", band: 6, comment: "c" },
            { name: "GRA", band: 6, comment: "d" },
          ],
        }),
      ),
      ESSAY,
    ),
  /comment must be a non-empty string/,
);
throws(
  "validate: no topFixes at all is a shape error",
  () => validateFeedback(JSON.parse(modelResponse({ topFixes: [] })), ESSAY),
  /topFixes/,
);
throws(
  "validate: a bare string is not feedback",
  () => validateFeedback("6.5", ESSAY),
  /not a JSON object/,
);
ok(
  "validate: shape errors are FeedbackShapeError, so gradeEssay can retry them",
  (() => {
    try {
      validateFeedback({}, ESSAY);
      return false;
    } catch (err) {
      return err instanceof FeedbackShapeError;
    }
  })(),
  "validateFeedback threw something other than FeedbackShapeError",
);

// --- rubric v2: the error inventory and the LR cap ----------------------------
//
// Phase 06's calibration ruling. Two mechanisms, both pinned here because both
// change a number the user is shown: the verbatim filter on `errors` (the same
// argument as `improvedSentences` — an error the candidate did not write is a
// fabrication) and the one cap code enforces, LR ≤ 6.0 once three real
// spelling/word-form errors survive that filter.

/** All verbatim substrings of ESSAY. */
const LR_ERRORS = ["beleive", "widens access", "means-tested"];

function withCriteria(
  bands: Record<"TR" | "CC" | "LR" | "GRA", number>,
  errors: Partial<Record<"TR" | "CC" | "LR" | "GRA", unknown>> = {},
): Record<string, unknown> {
  return {
    criteria: CRITERION_ORDER.map((name) => ({
      name,
      errors: errors[name] ?? [],
      band: bands[name],
      comment: `comment for ${name}`,
    })),
  };
}

const clamped = validateFeedback(
  JSON.parse(
    modelResponse(
      withCriteria({ TR: 6, CC: 6.5, LR: 7, GRA: 6 }, { LR: LR_ERRORS }),
    ),
  ),
  ESSAY,
);
check("clamp: LR 7.0 with three verbatim errors becomes 6.0", clamped.criteria[2].band, 6.0);
check("clamp: and says so, rather than clamping silently", clamped.criteria[2].capped, true);
check("clamp: the three errors are kept as evidence", clamped.criteria[2].errors, LR_ERRORS);
// Unclamped the mean is 6.375 → 6.5; clamped it is 6.125 → 6.0. The overall
// band has to follow the clamp, or the cap is decoration.
check("clamp: the overall mean follows it down (6.5 → 6.0)", clamped.overallBand, 6.0);
check(
  "clamp: the other three criteria are untouched",
  clamped.criteria.filter((c) => c.capped).map((c) => c.name),
  ["LR"],
);
check(
  "control: the same bands WITHOUT the errors keep LR 7.0 and overall 6.5",
  (() => {
    const control = validateFeedback(
      JSON.parse(modelResponse(withCriteria({ TR: 6, CC: 6.5, LR: 7, GRA: 6 }))),
      ESSAY,
    );
    return [control.criteria[2].band, control.overallBand, control.criteria[2].capped];
  })(),
  [7, 6.5, false],
);

check(
  "clamp: two errors is under the threshold, LR stays 7.0",
  validateFeedback(
    JSON.parse(
      modelResponse(withCriteria({ TR: 6, CC: 6, LR: 7, GRA: 6 }, { LR: LR_ERRORS.slice(0, 2) })),
    ),
    ESSAY,
  ).criteria[2].band,
  7,
);

// The filter is what makes the count trustworthy: three quotes, one invented.
const invented3 = validateFeedback(
  JSON.parse(
    modelResponse(
      withCriteria(
        { TR: 6, CC: 6, LR: 7, GRA: 6 },
        { LR: ["beleive", "widens access", "the goverment must intervene"] },
      ),
    ),
  ),
  ESSAY,
);
check("filter: an error not in the essay is dropped", invented3.criteria[2].errors, [
  "beleive",
  "widens access",
]);
check("filter: so two survivors do NOT trigger the cap", invented3.criteria[2].band, 7);

const duplicated = validateFeedback(
  JSON.parse(
    modelResponse(
      withCriteria(
        { TR: 6, CC: 6, LR: 7, GRA: 6 },
        { LR: ["beleive", "beleive", " beleive ", "widens access"] },
      ),
    ),
  ),
  ESSAY,
);
check("filter: the same quote three times is ONE error", duplicated.criteria[2].errors, [
  "beleive",
  "widens access",
]);
check("filter: and therefore does not reach the threshold", duplicated.criteria[2].band, 7);

check(
  "filter: non-string entries are dropped",
  validateFeedback(
    JSON.parse(
      modelResponse(
        withCriteria({ TR: 6, CC: 6, LR: 6, GRA: 6 }, { LR: ["beleive", 42, null, ""] }),
      ),
    ),
    ESSAY,
  ).criteria[2].errors,
  ["beleive"],
);
check(
  "filter: a missing errors key is an empty list, not a shape error",
  validateFeedback(JSON.parse(modelResponse()), ESSAY).criteria.map((c) => c.errors),
  [[], [], [], []],
);
check(
  "filter: a non-array errors value is an empty list too",
  validateFeedback(
    JSON.parse(modelResponse(withCriteria({ TR: 6, CC: 6, LR: 6, GRA: 6 }, { LR: "beleive" }))),
    ESSAY,
  ).criteria[2].errors,
  [],
);
check(
  "filter: the per-criterion list is capped at 10",
  validateFeedback(
    JSON.parse(
      modelResponse(
        withCriteria(
          { TR: 6, CC: 6, LR: 5, GRA: 6 },
          {
            GRA: [
              "Some",
              "people",
              "argue",
              "university",
              "education",
              "should",
              "funded",
              "state",
              "opinion",
              "tuition",
              "families",
            ],
          },
        ),
      ),
    ),
    ESSAY,
  ).criteria[3].errors.length,
  10,
);

// The cap only ever lowers, and only ever LR.
check(
  "clamp: LR already at 5.5 is not raised to 6.0",
  validateFeedback(
    JSON.parse(
      modelResponse(withCriteria({ TR: 6, CC: 6, LR: 5.5, GRA: 6 }, { LR: LR_ERRORS })),
    ),
    ESSAY,
  ).criteria[2].band,
  5.5,
);
check(
  "clamp: LR exactly at 6.0 is left alone and NOT marked capped",
  (() => {
    const at6 = validateFeedback(
      JSON.parse(
        modelResponse(withCriteria({ TR: 6, CC: 6, LR: 6, GRA: 6 }, { LR: LR_ERRORS })),
      ),
      ESSAY,
    );
    return [at6.criteria[2].band, at6.criteria[2].capped];
  })(),
  [6, false],
);
check(
  "clamp: three verbatim errors on CC do NOT cap it — that rule is prompt-level",
  (() => {
    const cc = validateFeedback(
      JSON.parse(
        modelResponse(withCriteria({ TR: 6, CC: 7.5, LR: 6, GRA: 6 }, { CC: LR_ERRORS })),
      ),
      ESSAY,
    );
    return [cc.criteria[1].band, cc.criteria[1].capped, cc.criteria[1].errors.length];
  })(),
  [7.5, false, 3],
);

// The prompt itself has to carry the rules the model is being held to. Half of
// the calibration lives there and cannot be asserted any other way.
const rubricV2 = buildGradingPrompt({
  taskType: "task2",
  promptMd: "Discuss both views and give your own opinion.",
  essay: ESSAY,
  minWords: 250,
});
ok(
  "rubric v2: the prompt orders evidence before banding",
  /FIRST list the specific evidence[\s\S]*THEN apply the descriptor/.test(rubricV2),
  "the evidence-first instruction is missing from the prompt",
);
ok(
  "rubric v2: all four evidence-tied caps are stated",
  ["LR is at most 6.0", "CC is at most 6.5", "GRA is at most 6.0", "TR is at most 5.0"].every(
    (cap) => rubricV2.includes(cap),
  ),
  "a cap is missing from the prompt",
);
ok(
  "rubric v2: the schema asks for errors before band",
  /"name": "LR", "errors":[\s\S]*?"band"/.test(rubricV2),
  "the response schema does not put errors before band",
);
ok(
  "rubric v2: the verbatim requirement is spelled out",
  rubricV2.includes("literal substring of the candidate essay"),
  "the prompt does not tell the model its quotes are checked",
);

// --- gradeEssay, with the model mocked ----------------------------------------

const LONG_ESSAY = `${ESSAY} ${"Furthermore, graduates earn more and contribute more in tax over a career, which makes public funding an investment rather than a handout. ".repeat(
  2,
)}`;
ok(
  "the fixture essay is long enough to be graded",
  countWords(LONG_ESSAY) >= MIN_ESSAY_WORDS,
  `the fixture essay is only ${countWords(LONG_ESSAY)} words`,
);

const TASK = {
  taskType: "task2" as const,
  promptMd: "Discuss both views and give your own opinion.",
  minWords: 250,
};

function recorder(replies: string[]): {
  chat: (prompt: string) => Promise<string>;
  prompts: string[];
} {
  const prompts: string[] = [];
  let call = 0;
  return {
    prompts,
    chat: async (prompt: string) => {
      prompts.push(prompt);
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return reply;
    },
  };
}

/** The mocked-model checks, in a function because tsx compiles these scripts
 *  to CJS and top-level await is not available there. */
async function gradeEssayChecks(): Promise<void> {
  {
    const { chat, prompts } = recorder([modelResponse()]);
    const feedback = await gradeEssay({ ...TASK, essay: LONG_ESSAY }, { chat });
    check("gradeEssay: one call on the happy path", prompts.length, 1);
    check("gradeEssay: four criteria", feedback.criteria.length, 4);
    check("gradeEssay: overall is the code-computed mean", feedback.overallBand, 6.0);
    ok(
      "gradeEssay: the prompt carries the rubric verbatim",
      prompts[0].includes("You are an experienced IELTS examiner grading one candidate essay."),
      "the architect's rubric is missing from the prompt",
    );
    ok(
      "gradeEssay: the prompt carries the essay and the minimum length",
      prompts[0].includes(LONG_ESSAY) && prompts[0].includes("MINIMUM LENGTH: 250 words"),
      "the prompt is missing the essay or the minimum length",
    );
    ok(
      "gradeEssay: the model is not asked for an overall band",
      prompts[0].includes('no "overall" field'),
      "the prompt does not tell the model the overall is computed in code",
    );
  }

  {
    // Fenced JSON with a reasoning preamble is `parseModelJson`'s job, not a retry.
    const { chat, prompts } = recorder([`<think>weighing TR</think>\n\`\`\`json\n${modelResponse()}\n\`\`\``]);
    const feedback = await gradeEssay({ ...TASK, essay: LONG_ESSAY }, { chat });
    check("gradeEssay: a fenced reply needs no retry", prompts.length, 1);
    check("gradeEssay: and grades normally", feedback.overallBand, 6.0);
  }

  {
    const { chat, prompts } = recorder(["not json at all", modelResponse()]);
    const feedback = await gradeEssay({ ...TASK, essay: LONG_ESSAY }, { chat });
    check("gradeEssay: an unparseable reply costs exactly one retry", prompts.length, 2);
    check("gradeEssay: the retry's result is used", feedback.overallBand, 6.0);
    ok(
      "gradeEssay: the retry tells the model what was wrong",
      prompts[1].includes("Your previous reply could not be used:"),
      "the retry prompt does not carry the parse error",
    );
  }

  {
    const badShape = JSON.stringify({ criteria: [], topFixes: ["a"] });
    const { chat, prompts } = recorder([badShape, modelResponse()]);
    await gradeEssay({ ...TASK, essay: LONG_ESSAY }, { chat });
    check("gradeEssay: a wrong-shaped reply also costs one retry", prompts.length, 2);
    ok(
      "gradeEssay: the retry names the shape problem",
      prompts[1].includes("exactly 4 entries"),
      "the retry prompt does not name the shape problem",
    );
  }

  {
    const { chat, prompts } = recorder(["still not json"]);
    let message = "";
    try {
      await gradeEssay({ ...TASK, essay: LONG_ESSAY }, { chat });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    check("gradeEssay: it gives up after two attempts", prompts.length, 2);
    ok(
      "gradeEssay: and fails visibly",
      /did not return usable feedback after two attempts/.test(message),
      `the failure message was ${JSON.stringify(message)}`,
    );
  }

  {
    // The refusal, and the property that matters about it: zero model calls.
    const { chat, prompts } = recorder([modelResponse()]);
    let caught: unknown = null;
    try {
      await gradeEssay({ ...TASK, essay: "Only thirty words here." }, { chat });
    } catch (err) {
      caught = err;
    }
    check("gradeEssay: a short essay spends NOTHING — zero model calls", prompts.length, 0);
    ok(
      "gradeEssay: and it refuses with EssayTooShortError",
      caught instanceof EssayTooShortError,
      `it threw ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    check(
      "gradeEssay: the refusal reports the word count",
      caught instanceof EssayTooShortError ? caught.words : null,
      4,
    );
  }

  {
    // 49 and 50 words: the boundary is inclusive of 50.
    const fortyNine = Array.from({ length: 49 }, (_, i) => `word${i}`).join(" ");
    const fifty = `${fortyNine} more`;
    check("countWords: the 49-word fixture really is 49", countWords(fortyNine), 49);
    check("countWords: the 50-word fixture really is 50", countWords(fifty), 50);

    const short = recorder([modelResponse()]);
    let refused = false;
    try {
      await gradeEssay({ ...TASK, essay: fortyNine }, { chat: short.chat });
    } catch {
      refused = true;
    }
    check("gradeEssay: 49 words is refused", refused, true);
    check("gradeEssay: 49 words costs no call", short.prompts.length, 0);

    const atLimit = recorder([modelResponse()]);
    await gradeEssay({ ...TASK, essay: fifty }, { chat: atLimit.chat });
    check("gradeEssay: exactly 50 words is graded", atLimit.prompts.length, 1);
  }

  {
    const { chat } = recorder([
      modelResponse({ lengthNote: "At 120 words this is well under the 250-word minimum." }),
    ]);
    const feedback = await gradeEssay({ ...TASK, essay: LONG_ESSAY }, { chat });
    ok(
      "gradeEssay: a lengthNote is carried through",
      feedback.lengthNote === "At 120 words this is well under the 250-word minimum.",
      `lengthNote came back as ${JSON.stringify(feedback.lengthNote)}`,
    );
  }
}

// --- feedbackToMarkdown -------------------------------------------------------

const markdown = feedbackToMarkdown(valid, { taskType: "task2", minWords: 250 });
ok(
  "markdown: carries the overall band and the ±0.5 label",
  markdown.includes("**Overall band 6.0**") && markdown.includes("AI estimate ±0.5"),
  markdown.slice(0, 200),
);
ok(
  "markdown: names all four criteria with their bands",
  ["TR — Task Response: 6.0", "CC — Coherence and Cohesion: 6.5", "LR — Lexical Resource: 5.5", "GRA — Grammatical Range and Accuracy: 6.0"].every(
    (heading) => markdown.includes(heading),
  ),
  markdown,
);
ok(
  "markdown: TR is Task Achievement on a Task 1",
  feedbackToMarkdown(valid, { taskType: "task1", minWords: 150 }).includes(
    "TR — Task Achievement",
  ),
  "Task 1 feedback still says Task Response",
);
ok(
  "markdown: carries the fixes and the rewrites",
  markdown.includes("### Top fixes") && markdown.includes("### Sentences to rewrite"),
  markdown,
);

// `ai_feedback_md` is what Phase 06's attempt history renders, so the evidence
// and the cap note have to survive into it — a band nobody can re-check months
// later is just a number.
const clampedMarkdown = feedbackToMarkdown(clamped, { taskType: "task2", minWords: 250 });
ok(
  "markdown: the LR cap is stated in the stored feedback",
  clampedMarkdown.includes("*Capped at 6.0: 3 spelling or word-form errors were found in the essay.*"),
  clampedMarkdown,
);
ok(
  "markdown: every quoted error is carried into the stored feedback",
  clampedMarkdown.includes("Found in your text (3):") &&
    LR_ERRORS.every((error) => clampedMarkdown.includes(`- \`${error}\``)),
  clampedMarkdown,
);
ok(
  "markdown: a criterion with no errors gets no evidence block",
  !clampedMarkdown.includes("### TR — Task Response: 6.0\n\ncomment for TR\n\nFound in your text"),
  clampedMarkdown,
);

// --- readEssayTask ------------------------------------------------------------

check(
  "readEssayTask: a well-formed writing content block",
  readEssayTask({ task_type: "task2", min_words: 250, prompt_md: "Discuss." }),
  { taskType: "task2", minWords: 250, promptMd: "Discuss." },
);
check("readEssayTask: a reading test's content is not a task", readEssayTask({ passage_md: "…" }), null);
check("readEssayTask: an unknown task type is rejected", readEssayTask({ task_type: "task3", min_words: 250, prompt_md: "x" }), null);
check("readEssayTask: a zero minimum is rejected", readEssayTask({ task_type: "task1", min_words: 0, prompt_md: "x" }), null);
check("readEssayTask: an empty prompt is rejected", readEssayTask({ task_type: "task1", min_words: 150, prompt_md: "  " }), null);
check("readEssayTask: null content", readEssayTask(null), null);

// --- markdown tables ----------------------------------------------------------
// The Task 1 prompt from content/seed/writing_bank_01.json, in shape.

const TASK1_PROMPT = `The table below shows the percentage of the population using the internet.

| Year | Internet users | Landline subscriptions |
|------|---------------|------------------------|
| 2005 | 10% | 30% |
| 2023 | 79% | 4% |

**Summarise the information.**

Write at least 150 words.`;

const blocks = splitMarkdownTables(TASK1_PROMPT);
check("tables: prose / table / prose", blocks.map((b) => b.kind), [
  "markdown",
  "table",
  "markdown",
]);
check(
  "tables: the header row",
  blocks[1].kind === "table" ? blocks[1].header : null,
  ["Year", "Internet users", "Landline subscriptions"],
);
check(
  "tables: the body rows, delimiter row excluded",
  blocks[1].kind === "table" ? blocks[1].rows : null,
  [
    ["2005", "10%", "30%"],
    ["2023", "79%", "4%"],
  ],
);
ok(
  "tables: the prose around it is preserved",
  blocks[0].kind === "markdown" &&
    blocks[0].text.includes("The table below shows") &&
    blocks[2].kind === "markdown" &&
    blocks[2].text.includes("Write at least 150 words."),
  JSON.stringify(blocks),
);

check(
  "tables: a prompt with no table is one markdown block",
  splitMarkdownTables("Some people believe X.\n\n**Discuss.**").map((b) => b.kind),
  ["markdown"],
);
check(
  "tables: pipes without a delimiter row are not a table",
  splitMarkdownTables("| this is just | a line with pipes |").map((b) => b.kind),
  ["markdown"],
);
check(
  "tables: alignment colons are still a delimiter row",
  splitMarkdownTables("| a | b |\n|:---|---:|\n| 1 | 2 |").map((b) => b.kind),
  ["table"],
);
check(
  "tables: two tables in one prompt",
  splitMarkdownTables("| a |\n|---|\n| 1 |\n\ntext\n\n| b |\n|---|\n| 2 |").map((b) => b.kind),
  ["table", "markdown", "table"],
);

// --- the panels, server-rendered -----------------------------------------------
// The browser walk-through is still blocked (see the phase report), so the
// markup is asserted one layer down: these are the real components, rendered
// with the real props, and what is checked is what the user would see.

const RENDER_ESSAY: PlayerEssay = {
  qnum: 1,
  prompt: "Write your report in response to the task above.",
  taskType: "task1",
  minWords: 150,
  promptMd: TASK1_PROMPT,
};
const RENDER_TEST: PlayerTest = {
  id: "t",
  skill: "writing",
  title: "Task 1: Internet and landline use in Vietnam",
  audioUrl: null,
  durationMinutes: 20,
  content: {},
  questions: [],
  essay: RENDER_ESSAY,
};

{
  // A Task 1 prompt's data is a markdown table, and a table it must render as.
  const markup = renderToStaticMarkup(
    createElement(EssayPanel, {
      essay: RENDER_ESSAY,
      text: "one two three",
      disabled: false,
      onChange: () => {},
    }),
  );
  ok(
    "render: the Task 1 table becomes a real <table>",
    markup.includes("<table") && markup.includes("<th") && markup.includes("Landline subscriptions"),
    markup.slice(0, 400),
  );
  ok(
    "render: every data row is present",
    ["2005", "10%", "2023", "79%"].every((cell) => markup.includes(`>${cell}</td>`)),
    markup,
  );
  ok(
    "render: the pipe characters do not leak into the page",
    !markup.includes("|------"),
    "an unrendered delimiter row reached the markup",
  );
  ok(
    "render: the prose around the table survives",
    markup.includes("Write at least 150 words."),
    markup,
  );
  ok("render: there is a textarea and no rich text editor", markup.includes("<textarea"), markup);
  ok(
    "render: the live word count is shown against the minimum",
    markup.includes("3 / 150 words"),
    markup,
  );
  ok(
    "render: below the minimum the count is NOT accent-coloured",
    markup.includes("var(--faint)") && !markup.includes("color:var(--accent)"),
    markup,
  );
}

{
  const markup = renderToStaticMarkup(
    createElement(EssayPanel, {
      essay: RENDER_ESSAY,
      text: Array.from({ length: 150 }, (_, i) => `w${i}`).join(" "),
      disabled: false,
      onChange: () => {},
    }),
  );
  ok(
    "render: at the minimum the word count turns accent-coloured",
    markup.includes("150 / 150 words") && markup.includes("var(--accent)"),
    markup,
  );
}

{
  const markup = renderToStaticMarkup(createElement(EssayRefusal, { words: 30 }));
  ok(
    "render: the refusal says nothing was saved and names the threshold",
    markup.includes("30 words") &&
      markup.includes(String(MIN_ESSAY_WORDS)) &&
      markup.includes("nothing was saved"),
    markup,
  );
}

{
  const withNote = validateFeedback(
    JSON.parse(modelResponse({ lengthNote: "This is 118 words, under the 150 minimum." })),
    ESSAY,
  );
  const markup = renderToStaticMarkup(
    createElement(EssayFeedbackPanel, {
      test: RENDER_TEST,
      essay: RENDER_ESSAY,
      feedback: withNote,
      text: ESSAY,
    }),
  );
  ok(
    "render: the overall band is labelled AI estimate ±0.5",
    markup.includes("6.0") && markup.includes("AI estimate ±0.5"),
    markup,
  );
  ok(
    "render: all four criteria with their bands",
    ["TR", "CC", "LR", "GRA"].every((name) => markup.includes(`>${name}</span>`)) &&
      markup.includes("Task Achievement"),
    markup,
  );
  ok("render: the top fixes are listed", markup.includes("Proofread for spelling."), markup);
  ok(
    "render: the improved sentence is shown with its original",
    markup.includes("I strongly beleive this balance works best."),
    markup,
  );
  ok("render: the lengthNote is shown when present", markup.includes("under the 150 minimum"), markup);
}

{
  // Rubric v2 on screen: the evidence under the band, and the cap admitted
  // rather than hidden inside a number.
  const markup = renderToStaticMarkup(
    createElement(EssayFeedbackPanel, {
      test: RENDER_TEST,
      essay: RENDER_ESSAY,
      feedback: clamped,
      text: ESSAY,
    }),
  );
  ok(
    "render: the quoted errors are shown under their criterion",
    LR_ERRORS.every((error) => markup.includes(`>${error}</li>`)),
    markup,
  );
  ok("render: the list is counted", markup.includes("Found in your text ("), markup);
  ok(
    "render: the clamp is disclosed, not silent",
    markup.includes("Capped at 6.0") &&
      markup.includes("spelling or word-form errors were found in your text"),
    markup,
  );
  ok(
    "render: a criterion with no errors gets no evidence block",
    (markup.match(/Found in your text \(/g) ?? []).length === 1,
    "an empty errors list still rendered a block",
  );
}

{
  // The wait UX. A static render only shows the first frame, which is exactly
  // the frame that has to be right: the counter starts at zero and the
  // expectation is on screen before any time has passed.
  const grading = renderToStaticMarkup(createElement(AiWait, GRADING_WAIT));
  ok(
    "render: the grading wait starts at 0s and states the expectation",
    grading.includes("Grading 0s") && grading.includes("usually 30–90 seconds"),
    grading,
  );
  ok(
    "render: it is announced to a screen reader",
    grading.includes('aria-live="polite"'),
    grading,
  );
  const explain = renderToStaticMarkup(createElement(AiWait, EXPLAIN_WAIT));
  ok(
    "render: the explain wait has its own, shorter expectation",
    explain.includes("Thinking 0s") && explain.includes("usually under 30 seconds"),
    explain,
  );
}

// --- Report -------------------------------------------------------------------

gradeEssayChecks()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} writing check(s) FAILED:\n`);
      for (const failure of failures) console.error(`  \u2717 ${failure}\n`);
      process.exit(1);
    }
    console.log("All writing checks passed.");
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
