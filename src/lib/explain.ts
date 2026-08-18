/**
 * "Why is my answer wrong?" — server-only, and deliberately amnesiac.
 *
 * The stored `explanation_md` says why the key is right. It was written for
 * nobody in particular. This says why the answer the user actually gave is
 * wrong, which is a different sentence every time, so it is generated on demand
 * and **never stored**: this module issues SELECTs and one `textChat` call, and
 * has no UPDATE, INSERT or DELETE in it at all. `scripts/check_writing_db.ts`
 * pins that by snapshotting the whole `attempts` row before and after and
 * comparing it byte for byte.
 *
 * The prompt is `enrich_explanations.ts`'s pattern with one addition: the model
 * is told the key is verified and final, and a reply that argues with it is
 * rejected rather than shown — the same dispute filter, because the same
 * failure mode (a model deciding the book is wrong) would be far more damaging
 * here, where the user is already sure they were right.
 */

import { createClient } from "@/lib/supabase/server";
import { parseModelJson, textChat } from "@/lib/ai";
import { normalizeAnswer } from "@/lib/normalize";

/** Two to five sentences with room to spare; no reasoning tokens. */
const MAX_COMPLETION_TOKENS = 1_024;

/** A reply longer than this is not an explanation, it is an essay. */
const MAX_EXPLANATION_CHARS = 1_200;

/** Verbatim from `scripts/enrich_explanations.ts` — the same rule, same words. */
const DISPUTE_PATTERNS: RegExp[] = [
  /\banswer key (is|appears|seems|may be|might be)?\s*(wrong|incorrect|mistaken)/i,
  /\bthe correct answer (should|would) be\b/i,
  /\bshould be (changed|corrected) to\b/i,
];

/**
 * Everything the prompt needs, all of it read back from the database by
 * `explainMyAnswer`. Exported with `buildExplainPrompt` so
 * `scripts/check_writing_db.ts` can drive the identical prompt and the
 * identical rejection filter through the admin client — this module runs on the
 * request-scoped client and cannot be called from a script.
 */
export interface ExplainTarget {
  testTitle: string;
  passage: string;
  qnum: number;
  qtype: string;
  prompt: string;
  options: string[] | null;
  answerKey: string[];
  storedExplanation: string | null;
  given: string;
}

export function buildExplainPrompt(target: ExplainTarget): string {
  const options =
    target.options === null
      ? "(this question has no printed options)"
      : target.options.map((option) => `- ${option}`).join("\n");

  return `You are an IELTS tutor sitting with one student, going over a question they
just got wrong. Explain THEIR mistake — not the question in general.

The passage below is the transcribed source text. The answer key has already been
verified against the book's own printed answers page. It is CORRECT.

RULES — follow all of them:
1. The answer key is given, verified and final. Do NOT dispute it, do NOT propose a
   different answer, and do NOT hedge about whether it is right. The student's
   answer is wrong; your job is to explain why.
2. Address the student's actual answer, quoted below. Say what made it tempting —
   which words in the passage or the question pulled them towards it — and then
   what in the text rules it out.
3. Quote the exact phrase from the passage that settles it, verbatim, inside single
   quotation marks. Copy it character for character; never paraphrase inside the
   quotation marks.
4. Write 2-5 sentences, addressed to the student as "you". No preamble, no bullet
   points, no headings, no restating of the question.
5. Write in English, in plain prose. Light markdown emphasis is allowed; nothing else.
6. If the student left the question unanswered, explain instead what in the passage
   points to the key, and what to look for next time.

TASK: ${target.testTitle}
QUESTION ${target.qnum} (${target.qtype}): ${target.prompt}

OPTIONS:
${options}

VERIFIED ANSWER KEY (accepted answers, any one of them is correct):
${target.answerKey.map((key) => `- ${key}`).join("\n")}

THE STUDENT'S ANSWER: ${target.given === "" ? "(left blank)" : target.given}
${
  target.storedExplanation
    ? `\nTHE EXPLANATION THEY HAVE ALREADY READ (do not simply repeat it):\n${target.storedExplanation}\n`
    : ""
}
PASSAGE:
${target.passage}

Reply with JSON and nothing else:
{"explanation": "<your 2-5 sentence explanation>"}`;
}

export function explanationRejectionReason(explanation: string): string | null {
  if (explanation.length > MAX_EXPLANATION_CHARS) {
    return `it ran to ${explanation.length} characters, past the ${MAX_EXPLANATION_CHARS}-character ceiling`;
  }
  for (const pattern of DISPUTE_PATTERNS) {
    if (pattern.test(explanation)) {
      return "it disputes the verified answer key";
    }
  }
  return null;
}

/**
 * One explanation for one wrong answer on one attempt. Reads everything back
 * from the database — the caller passes identifiers, never content — so a
 * tampered client payload cannot put words in the model's mouth.
 *
 * Throws if the answer was in fact correct: a correct question has no button,
 * and the server does not take the client's word for which is which.
 */
export async function explainMyAnswer(
  attemptId: string,
  qnum: number,
): Promise<string> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .from("attempts")
    .select("id, test_id, answers, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    throw new Error(`Failed to load attempt ${attemptId}: ${attemptError.message}`);
  }
  if (!attempt) throw new Error(`No attempt with id ${attemptId}`);
  if (attempt.submitted_at === null) {
    throw new Error(
      `Attempt ${attemptId} has not been submitted — there is nothing graded to explain.`,
    );
  }

  const testId = attempt.test_id as string;

  const [testResult, questionResult] = await Promise.all([
    supabase.from("tests").select("title, content").eq("id", testId).maybeSingle(),
    supabase
      .from("questions")
      .select("qnum, qtype, prompt, options, answer_key, explanation_md")
      .eq("test_id", testId)
      .eq("qnum", qnum)
      .maybeSingle(),
  ]);

  if (testResult.error) {
    throw new Error(`Failed to load test ${testId}: ${testResult.error.message}`);
  }
  if (questionResult.error) {
    throw new Error(
      `Failed to load question ${qnum} of test ${testId}: ${questionResult.error.message}`,
    );
  }
  if (!testResult.data) throw new Error(`Attempt ${attemptId} references missing test ${testId}`);
  if (!questionResult.data) throw new Error(`Test ${testId} has no question ${qnum}`);

  const question = questionResult.data;
  const answerKey = Array.isArray(question.answer_key)
    ? (question.answer_key as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  if (answerKey.length === 0) {
    throw new Error(
      `Question ${qnum} has no answer key, so there is no "wrong" to explain.`,
    );
  }

  const answers = (attempt.answers ?? {}) as Record<string, unknown>;
  const submitted = answers[String(qnum)];
  const given = typeof submitted === "string" ? submitted.trim() : "";

  // The same comparison the grader made — a correct answer gets no button, and
  // no explanation either, however the request arrived.
  const normalized = normalizeAnswer(given);
  const wasCorrect =
    normalized !== "" && answerKey.some((key) => normalizeAnswer(key) === normalized);
  if (wasCorrect) {
    throw new Error(
      `Question ${qnum} was answered correctly — there is nothing to explain away.`,
    );
  }

  const content = testResult.data.content;
  const record =
    typeof content === "object" && content !== null && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : {};
  const passage =
    (typeof record.passage_md === "string" ? record.passage_md : null) ??
    (typeof record.transcript_md === "string" ? record.transcript_md : null) ??
    "";
  if (passage.trim() === "") {
    throw new Error(
      "This test has no transcribed passage stored, so an explanation could only be guesswork.",
    );
  }

  const raw = await textChat(
    buildExplainPrompt({
      testTitle: testResult.data.title as string,
      passage,
      qnum,
      qtype: question.qtype as string,
      prompt: question.prompt as string,
      options: Array.isArray(question.options)
        ? (question.options as unknown[]).filter((o): o is string => typeof o === "string")
        : null,
      answerKey,
      storedExplanation: (question.explanation_md as string | null) ?? null,
      given,
    }),
    { maxCompletionTokens: MAX_COMPLETION_TOKENS },
  );

  const parsed = parseModelJson<{ explanation?: unknown }>(raw);
  const explanation =
    typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";

  if (explanation === "") {
    throw new Error("The model returned no explanation. Try again.");
  }

  const reason = explanationRejectionReason(explanation);
  if (reason !== null) {
    throw new Error(
      `That explanation was rejected because ${reason}. Nothing was saved; try again.`,
    );
  }

  return explanation;
}
