/**
 * Fill in missing per-question explanations on a staged file — text only.
 *
 *   npx tsx scripts/enrich_explanations.ts content/staged/<basename>.json
 *   npx tsx scripts/enrich_explanations.ts content/staged/<basename>.json --dry-run
 *
 * Phase 03 carry-over (b). A question extracted in a chunk that did not hold its
 * passage has no `explanation_md`, so the Review step shows nothing for it. This
 * asks the model for one sentence or two, grounded in a phrase quoted verbatim
 * from the passage the same staged file already carries.
 *
 * Three properties this script is built around:
 *
 *  1. **It writes ONLY `explanation_md`.** Every other byte of the staged file is
 *     verified byte-identical before anything is saved: the parsed file is
 *     re-serialized with all explanations blanked on both sides, and a mismatch
 *     aborts without writing. An explanation is commentary; a prompt, an option
 *     or an answer key is content, and content is not this script's to touch.
 *  2. **The answer key is an input, never an output.** The prompt states the key
 *     is verified and correct, and forbids disputing or revising it. A response
 *     that argues with the key is rejected rather than stored.
 *  3. **Text only.** One `textChat` call per question, no images — so it runs on
 *     the free OpenCode Zen text models, unlike the vision extraction path.
 *
 * Nothing here reaches the database: like `ingest.ts` this writes to
 * `content/staged/` only, and `ingest_commit.ts` remains the single path in.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

import { parseStagedFile, ValidationError, type StagedFile } from "./lib/validate";

// `src/lib/ai.ts` reads its credentials through `config.ts` at module scope, and
// ES modules evaluate every static import before the first statement of this
// file — including `process.loadEnvFile` above. So the AI client is imported
// dynamically, after the environment exists. Same reason as in `ingest.ts`.

class EnrichError extends Error {}

/** Enough for two sentences with room to spare; a text call pays no image cost. */
const MAX_COMPLETION_TOKENS = 1_024;

/** Guard against a model that answers with an essay instead of a sentence or two. */
const MAX_EXPLANATION_CHARS = 600;

interface Target {
  slug: string;
  title: string;
  qnum: number;
  qtype: string;
  prompt: string;
  options: string[] | null;
  answerKey: string[];
  passage: string;
}

function explanationPrompt(target: Target): string {
  const options =
    target.options === null
      ? "(this question has no printed options)"
      : target.options.map((option) => `- ${option}`).join("\n");

  return `You are annotating a real IELTS practice test with short answer explanations.

The passage below is the transcribed source text. The answer key has already been
verified against the book's own printed answers page. It is CORRECT.

RULES — follow all of them:
1. The answer key is given, verified and final. Do NOT dispute it, do NOT propose a
   different answer, and do NOT hedge about whether it is right. Your job is only to
   explain WHY it is right.
2. Quote the exact phrase from the passage that justifies the answer, verbatim,
   inside single quotation marks. Copy it character for character from the passage —
   never paraphrase inside the quotation marks.
3. Write 1-2 sentences. No preamble, no bullet points, no headings, no restating of
   the question.
4. Write in English, in plain prose. Light markdown emphasis is allowed; nothing else.
5. If the passage does not actually contain a phrase that justifies the answer,
   return an empty string for "explanation_md" rather than inventing support.

TASK: ${target.title}
QUESTION ${target.qnum} (${target.qtype}): ${target.prompt}

OPTIONS:
${options}

VERIFIED ANSWER KEY (accepted answers, any one of them is correct):
${target.answerKey.map((key) => `- ${key}`).join("\n")}

PASSAGE:
${target.passage}

Reply with JSON and nothing else:
{"explanation_md": "<your 1-2 sentence explanation>"}`;
}

/** A model that argues with the key has broken rule 1 — reject rather than store. */
const DISPUTE_PATTERNS: RegExp[] = [
  /\banswer key (is|appears|seems|may be|might be)?\s*(wrong|incorrect|mistaken)/i,
  /\bthe correct answer (should|would) be\b/i,
  /\bshould be (changed|corrected) to\b/i,
];

function rejectionReason(explanation: string): string | null {
  if (explanation.length > MAX_EXPLANATION_CHARS) {
    return `it is ${explanation.length} characters long, past the ${MAX_EXPLANATION_CHARS}-character ceiling`;
  }
  for (const pattern of DISPUTE_PATTERNS) {
    if (pattern.test(explanation)) {
      return "it disputes the verified answer key, which this script is not allowed to change";
    }
  }
  return null;
}

/** The staged file with every explanation blanked — the part that must not move. */
function skeleton(file: StagedFile): string {
  return JSON.stringify(
    {
      ...file,
      tests: file.tests.map((test) => ({
        ...test,
        questions: test.questions.map((question) => ({
          ...question,
          explanation_md: null,
        })),
      })),
    },
    null,
    2,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.find((arg) => !arg.startsWith("--"));

  if (!fileArg) {
    throw new EnrichError(
      "Usage: npx tsx scripts/enrich_explanations.ts <path-to-staged.json> [--dry-run]",
    );
  }

  const path = resolve(process.cwd(), fileArg);
  const before = readFileSync(path, "utf8");

  let json: unknown;
  try {
    json = JSON.parse(before);
  } catch (err) {
    throw new EnrichError(
      `Could not parse ${fileArg}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Soft mode: a staged file legitimately carries rule violations (that is what
  // review.md is for). This script only needs it to be structurally sound.
  const { file } = parseStagedFile(json, "soft");
  const skeletonBefore = skeleton(file);

  // Re-serializing what was read must reproduce the file on disk byte for byte,
  // or "only explanation_md changed" would be a claim about the parsed object
  // rather than about the file. Refuse rather than silently reformat.
  if (`${JSON.stringify(file, null, 2)}\n` !== before) {
    throw new EnrichError(
      `ABORTED without writing: re-serializing ${basename(path)} does not reproduce it ` +
        "byte for byte, so saving would change fields this script must not touch. " +
        "Re-stage the file with `npx tsx scripts/ingest.ts --from-logs` first.",
    );
  }

  const targets: Array<{ target: Target; questionIndex: number; testIndex: number }> = [];
  let noPassage = 0;

  file.tests.forEach((test, testIndex) => {
    const passage = test.content.passage_md ?? test.content.transcript_md ?? "";
    test.questions.forEach((question, questionIndex) => {
      const existing = question.explanation_md ?? "";
      if (existing.trim() !== "") return;
      if (passage.trim() === "") {
        noPassage += 1;
        return;
      }
      targets.push({
        testIndex,
        questionIndex,
        target: {
          slug: test.slug,
          title: test.title,
          qnum: question.qnum,
          qtype: question.qtype,
          prompt: question.prompt,
          options: question.options,
          answerKey: question.answer_key,
          passage,
        },
      });
    });
  });

  const total = file.tests.reduce((n, test) => n + test.questions.length, 0);
  console.log(
    `${basename(path)}: ${total} question(s), ${targets.length} without an explanation` +
      (noPassage > 0
        ? `, ${noPassage} skipped for having no transcribed passage to quote`
        : "") +
      ".",
  );

  if (targets.length === 0) {
    console.log("Nothing to enrich.");
    return;
  }

  const { parseModelJson, textChat } = await import("../src/lib/ai");

  const filled: string[] = [];
  const skipped: string[] = [];

  for (const [index, { target, testIndex, questionIndex }] of targets.entries()) {
    const label = `${target.slug} q${target.qnum}`;
    process.stdout.write(`  [${index + 1}/${targets.length}] ${label} … `);

    if (target.answerKey.length === 0) {
      // Without a verified key there is nothing to explain, and guessing one is
      // exactly what fidelity rule 2 forbids.
      skipped.push(`${label}: no answer key to explain`);
      console.log("skipped (no answer key)");
      continue;
    }

    let explanation: string;
    try {
      const raw = await textChat(explanationPrompt(target), {
        maxCompletionTokens: MAX_COMPLETION_TOKENS,
      });
      const parsed = parseModelJson<{ explanation_md?: unknown }>(raw);
      explanation =
        typeof parsed.explanation_md === "string" ? parsed.explanation_md.trim() : "";
    } catch (err) {
      skipped.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      console.log("failed");
      continue;
    }

    if (explanation === "") {
      skipped.push(`${label}: the model returned no explanation`);
      console.log("skipped (empty)");
      continue;
    }

    const reason = rejectionReason(explanation);
    if (reason !== null) {
      skipped.push(`${label}: rejected because ${reason}`);
      console.log("rejected");
      continue;
    }

    file.tests[testIndex].questions[questionIndex].explanation_md = explanation;
    filled.push(`${label}: ${explanation}`);
    console.log("done");
  }

  console.log(
    `\n${filled.length} explanation(s) written, ${skipped.length} skipped.` +
      (dryRun ? " (--dry-run: nothing saved)" : ""),
  );
  for (const line of skipped) console.log(`  ! ${line}`);

  if (dryRun) {
    for (const line of filled) console.log(`  · ${line}`);
    return;
  }
  if (filled.length === 0) return;

  // The guarantee: everything except `explanation_md` is byte-identical.
  const skeletonAfter = skeleton(file);
  if (skeletonAfter !== skeletonBefore) {
    throw new EnrichError(
      "ABORTED without writing: enrichment changed something other than `explanation_md`. " +
        "That is a bug in this script — the staged file on disk is untouched.",
    );
  }

  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\nWrote ${path}`);
  console.log(
    "Verified: every field except `explanation_md` is byte-identical to the file " +
      "that was read.",
  );

  // Keep the audit trail where the user already reads it. review.md's own
  // "Explained" column was written by ingest.ts and predates this run.
  const reviewPath = join(
    dirname(path),
    `${basename(path, extname(path))}.review.md`,
  );
  try {
    const review = readFileSync(reviewPath, "utf8");
    writeFileSync(
      reviewPath,
      `${review.trimEnd()}\n\n## Explanation enrichment — ${new Date().toISOString()}\n\n` +
        `\`scripts/enrich_explanations.ts\` filled ${filled.length} empty ` +
        `\`explanation_md\` field(s) with a text-only AI call. No other field was ` +
        `changed (verified byte-for-byte). The "Explained" column above predates ` +
        `this run.\n\n` +
        filled.map((line) => `- ${line}`).join("\n") +
        (skipped.length > 0
          ? `\n\nSkipped:\n\n${skipped.map((line) => `- ${line}`).join("\n")}`
          : "") +
        "\n",
    );
    console.log(`Appended an audit section to ${reviewPath}`);
  } catch {
    // No review file (or it is not readable) — the staged file is still written.
  }
}

main().catch((err: unknown) => {
  if (err instanceof EnrichError || err instanceof ValidationError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
