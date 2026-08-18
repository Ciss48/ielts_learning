/**
 * Live check for the writing + explain paths.
 *
 *   npx tsx scripts/check_writing_db.ts
 *
 * `src/lib/tests.ts` and `src/lib/explain.ts` run on the request-scoped Supabase
 * client, which needs a Next.js request and a signed-in session, so they cannot
 * be called from a script. This issues the **same PostgREST calls in the same
 * order** through the admin client, driving the real `gradeEssay`, the real
 * `buildExplainPrompt` and the real rejection filter — so the model call and
 * everything that reads or validates it is the shipping code, and only the
 * client is mirrored. Same arrangement as `scripts/check_vocab_db.ts`.
 *
 * It spends tokens: two essays are graded live and one explanation is
 * generated. It prints a rough token estimate per call so the daily pool can be
 * budgeted against ingestion.
 *
 * It is non-destructive: every attempt it creates is deleted again, and it
 * refuses to touch an attempt that existed before it ran. The sample essays are
 * executor-authored TEST INPUT (explicitly authorized by
 * `tasks/phase_05_writing_ai.md`) — they are not IELTS content and nothing
 * writes them to a seed file.
 */

import { resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

// Everything that reaches `src/lib/config.ts` is imported dynamically, inside
// `main`. ES modules evaluate every static import before the first statement of
// this file — including the `loadEnvFile` above — so a static import here would
// capture an empty environment and the admin client would have no key. Same
// reason as in `ingest.ts`.
import type { ObjectiveQType } from "../src/lib/tests";
import { normalizeAnswer } from "../src/lib/normalize";

const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function ok(name: string, condition: boolean, detail: string): void {
  if (!condition) failures.push(`${name}\n    ${detail}`);
}

/** Rough, and labelled as such: ~4 characters per token for English prose. */
function roughTokens(chars: number): number {
  return Math.round(chars / 4);
}

/**
 * Does the explanation actually talk about the answer the user gave?
 *
 * A choice option is stored with its printed label ("B the Indians"), and a
 * tutor writing to a student naturally drops the label ("You chose 'the
 * Indians'"). So the label is stripped before matching, and a long option falls
 * back to its content words — this asserts the explanation is about their
 * answer without demanding it quote a letter no human would say out loud.
 */
function referencesAnswer(explanation: string, given: string): boolean {
  const haystack = explanation.toLowerCase();
  const core = given
    .toLowerCase()
    .replace(/^[a-z][.):\-]?\s+/, "")
    .trim();
  if (core !== "" && haystack.includes(core)) return true;

  const contentWords = core
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);
  return (
    contentWords.length > 0 && contentWords.every((word) => haystack.includes(word))
  );
}

/** A stable, whole-row snapshot, for the "nothing was written" proof. */
function snapshot(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))),
  );
}

// --- test input, written by the executor -------------------------------------

/** 280 words, deliberately at an intermediate level with real weaknesses. */
const SAMPLE_ESSAY = `Nowadays there is a big debate about who should pay for university education. Some people think the government should pay for everything, while other people believe that students themselves have to pay their own fees. In this essay I will discuss both sides and give my own opinion.

On the one hand, there are strong arguments for free university education. Firstly, it gives equal chances to everybody. If tuition is expensive, many clever students from poor families cannot continue their study, and the country loses their talent. Secondly, graduates usually earn higher salaries, so they pay more tax during their working life. In this way the government gets its money back and even more. For example, in some European countries like Germany, university is free and the economy is still very strong.

On the other hand, other people argue that students should pay. The main reason is money. Universities are very expensive to run, and if the state pays for all of them, the tax for ordinary workers must increase. Many of these workers never went to university, so it is not fair for them. Moreover, when students pay their own fees, they take their study more seriously, because they know how much it costs. They also choose their subject more carefully instead of wasting three years.

In my opinion, the best solution is somewhere in the middle. The government should pay the full fee for students from low income families and for subjects the country really needs, such as medicine and teaching. Other students should pay a part of the cost, and they can return the money slowly after they start working. I strongly beleive this system is more fair than the two extreme options.`;

/** ~120 words: long enough to grade, comfortably short of the 250 minimum. */
const SHORT_TASK2_ESSAY = `Social media is very popular with young people today. They spend many hours every day on applications like TikTok and Instagram. There are two main reasons for this. First, these applications are designed to be addictive, so it is difficult to stop scrolling. Second, young people want to stay connected with their friends, and social media is the easiest way.

In my opinion the disadvantages are bigger than the advantages. Young people sleep less and they compare themselves with perfect pictures, so they feel bad about their own life. However, social media also helps them to find information and to learn new skills quickly. Parents and schools should teach young people to use it in a balanced way.`;

/**
 * What `SAMPLE_ESSAY` scored under Phase 05's rubric v1, recorded from the live
 * run in `memory/phase_05_report.md`. Phase 06's calibration is measured against
 * it: same essay, same task, same provider, new rubric.
 */
const PHASE_05_BASELINE = {
  criteria: [
    ["TR", 7.0],
    ["CC", 7.0],
    ["LR", 6.5],
    ["GRA", 6.5],
  ] as ReadonlyArray<readonly [string, number]>,
  overall: 7.0,
} as const;

/** 30 words. It must never reach the provider. */
const TOO_SHORT_ESSAY =
  "University should be free for everyone because education is important for the country and for the future of young people who want to study hard and succeed in life.";

async function main(): Promise<void> {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const supabase = createAdminClient();

  const {
    MIN_ESSAY_WORDS,
    countWords,
    feedbackToMarkdown,
    gradeEssay,
    readEssayTask,
    snapBand,
  } = await import("../src/lib/writing");
  const { buildExplainPrompt, explanationRejectionReason } = await import(
    "../src/lib/explain"
  );
  const { parseModelJson, textChat } = await import("../src/lib/ai");
  const { gradeAnswers } = await import("../src/lib/tests");

  check(
    "the 30-word sample really is under the threshold",
    countWords(TOO_SHORT_ESSAY) < MIN_ESSAY_WORDS,
    true,
  );
  check("the long sample clears 250 words", countWords(SAMPLE_ESSAY) >= 250, true);
  check(
    "the short Task 2 sample sits between 50 and 250",
    countWords(SHORT_TASK2_ESSAY) >= MIN_ESSAY_WORDS &&
      countWords(SHORT_TASK2_ESSAY) < 250,
    true,
  );

  // --- Guard: never disturb an attempt the user actually made -----------------
  const { data: preexisting, error: preexistingError } = await supabase
    .from("attempts")
    .select("id");
  if (preexistingError) throw new Error(preexistingError.message);
  const untouchable = new Set((preexisting ?? []).map((row) => row.id as string));
  const created: string[] = [];
  console.log(
    `Attempts before: ${untouchable.size}. None of them will be read, modified or deleted.`,
  );

  async function startAttempt(testId: string): Promise<string> {
    const { data, error } = await supabase
      .from("attempts")
      .insert({ unit_id: null, test_id: testId })
      .select("id")
      .single();
    if (error) throw new Error(`Could not start an attempt: ${error.message}`);
    const id = data.id as string;
    created.push(id);
    return id;
  }

  async function readAttempt(attemptId: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase
      .from("attempts")
      .select("*")
      .eq("id", attemptId)
      .single();
    if (error) throw new Error(`Could not read attempt ${attemptId}: ${error.message}`);
    return data as Record<string, unknown>;
  }

  // =========================================================================
  // 1. Objective grading is untouched — the Phase 02 known-answer check, run
  //    against the LIVE unit 9 test data rather than a fixture copy of it.
  // =========================================================================
  const { data: unit9, error: unit9Error } = await supabase
    .from("units")
    .select("id, seq, test_id")
    .eq("seq", 9)
    .maybeSingle();
  if (unit9Error) throw new Error(unit9Error.message);
  if (!unit9?.test_id) throw new Error("Unit 9 has no test — seed content/seed/week_02.json.");

  const { data: unit9Questions, error: unit9QError } = await supabase
    .from("questions")
    .select("qnum, qtype, answer_key")
    .eq("test_id", unit9.test_id as string)
    .order("qnum", { ascending: true });
  if (unit9QError) throw new Error(unit9QError.message);

  const graded9 = (unit9Questions ?? []).map((row) => ({
    qnum: row.qnum as number,
    qtype: row.qtype as ObjectiveQType,
    answerKey: (row.answer_key as string[]) ?? [],
  }));
  check("unit 9 still has 13 questions", graded9.length, 13);

  // The first accepted key for every question — i.e. the paper answered right.
  const perfectAnswers: Record<number, string> = {};
  for (const q of graded9) perfectAnswers[q.qnum] = q.answerKey[0];
  const perfect = gradeAnswers(graded9, perfectAnswers);
  check("unit 9, every stored key accepted: 13/13", perfect.scoreRaw, 13);
  check("unit 9: scoreTotal", perfect.scoreTotal, 13);
  const blank = gradeAnswers(graded9, {});
  check("unit 9, nothing answered: 0/13", blank.scoreRaw, 0);
  check("unit 9 blank: still 13 results", blank.perQuestion.length, 13);

  // =========================================================================
  // 2. The writing bank, as seeded.
  // =========================================================================
  const { data: writingTests, error: writingError } = await supabase
    .from("tests")
    .select("id, slug, skill, title, duration_minutes, content")
    .eq("skill", "writing")
    .order("slug", { ascending: true });
  if (writingError) throw new Error(writingError.message);

  const bank = writingTests ?? [];
  check("three writing tests in the bank", bank.length, 3);
  check(
    "their slugs",
    bank.map((t) => t.slug),
    ["writing-t1-internet-vietnam", "writing-t2-social-media", "writing-t2-university-fees"],
  );

  for (const test of bank) {
    const task = readEssayTask(test.content);
    ok(
      `${test.slug}: content is a usable writing task`,
      task !== null,
      `readEssayTask returned null for ${JSON.stringify(test.content)}`,
    );

    const { data: questions, error: qError } = await supabase
      .from("questions")
      .select("qnum, qtype, answer_key, options")
      .eq("test_id", test.id as string);
    if (qError) throw new Error(qError.message);
    check(`${test.slug}: exactly one question`, (questions ?? []).length, 1);
    check(`${test.slug}: it is an essay`, questions?.[0]?.qtype, "essay");
    check(`${test.slug}: with an empty answer key`, questions?.[0]?.answer_key, []);
    check(`${test.slug}: and no options`, questions?.[0]?.options, null);
  }

  const feesTest = bank.find((t) => t.slug === "writing-t2-university-fees");
  if (!feesTest) throw new Error("writing-t2-university-fees is not seeded.");
  const feesTask = readEssayTask(feesTest.content);
  if (!feesTask) throw new Error("writing-t2-university-fees has unusable content.");

  // =========================================================================
  // 3. The refusal — and the property that matters: ZERO model calls.
  // =========================================================================
  {
    const attemptId = await startAttempt(feesTest.id as string);
    let calls = 0;
    let refused = "";
    try {
      // Mirrors `submitEssayAttempt`: the word check happens before the model
      // call is even constructed. The injected chat exists only to fail loudly
      // if that is ever untrue.
      const words = countWords(TOO_SHORT_ESSAY);
      if (words < MIN_ESSAY_WORDS) {
        refused = `refused at ${words} words`;
      } else {
        await gradeEssay(
          {
            taskType: feesTask.taskType,
            promptMd: feesTask.promptMd,
            essay: TOO_SHORT_ESSAY,
            minWords: feesTask.minWords,
          },
          {
            chat: async (prompt) => {
              calls += 1;
              return textChat(prompt);
            },
          },
        );
      }
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err);
    }

    check("a 30-word submission spends ZERO model calls", calls, 0);
    ok("and it is refused", refused !== "", "nothing refused the short essay");

    const row = await readAttempt(attemptId);
    check("the refused attempt is still unsubmitted", row.submitted_at, null);
    check("with no band", row.band_estimate, null);
    check("with no feedback", row.ai_feedback_md, null);
    check("and nothing in answers", row.answers, {});
    console.log(`  · refusal: ${refused}`);
  }

  // =========================================================================
  // 4. The live essay flow, on writing-t2-university-fees.
  // =========================================================================
  {
    const attemptId = await startAttempt(feesTest.id as string);

    let promptChars = 0;
    let replyChars = 0;
    let calls = 0;
    const startedAt = Date.now();

    const feedback = await gradeEssay(
      {
        taskType: feesTask.taskType,
        promptMd: feesTask.promptMd,
        essay: SAMPLE_ESSAY,
        minWords: feesTask.minWords,
      },
      {
        // The real provider call, measured on the way through.
        chat: async (prompt) => {
          calls += 1;
          promptChars += prompt.length;
          const reply = await textChat(prompt, { maxCompletionTokens: 3_000 });
          replyChars += reply.length;
          return reply;
        },
      },
    );
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    check("exactly four criteria", feedback.criteria.length, 4);
    check(
      "in TR/CC/LR/GRA order",
      feedback.criteria.map((c) => c.name),
      ["TR", "CC", "LR", "GRA"],
    );
    ok(
      "every band is a half step inside 0-9",
      feedback.criteria.every((c) => c.band === snapBand(c.band)),
      `bands were ${feedback.criteria.map((c) => c.band).join(", ")}`,
    );
    const mean =
      feedback.criteria.reduce((sum, c) => sum + c.band, 0) / feedback.criteria.length;
    check("overall equals the code-computed mean", feedback.overallBand, snapBand(mean));
    ok(
      "3-5 top fixes",
      feedback.topFixes.length >= 3 && feedback.topFixes.length <= 5,
      `got ${feedback.topFixes.length}`,
    );
    ok(
      "every improved sentence is verbatim from the essay",
      feedback.improvedSentences.every((s) => SAMPLE_ESSAY.includes(s.original)),
      "an improved sentence quotes text the candidate never wrote",
    );

    // Mirrors `submitEssayAttempt`'s single UPDATE, field for field.
    const { error: updateError } = await supabase
      .from("attempts")
      .update({
        submitted_at: new Date().toISOString(),
        answers: { essay: SAMPLE_ESSAY },
        score_raw: null,
        score_total: null,
        band_estimate: feedback.overallBand,
        ai_feedback_md: feedbackToMarkdown(feedback, feesTask),
      })
      .eq("id", attemptId);
    if (updateError) throw new Error(updateError.message);

    const row = await readAttempt(attemptId);
    ok("the attempt is submitted", row.submitted_at !== null, "submitted_at is null");
    check(
      "band_estimate is stored, and is the overall band",
      Number(row.band_estimate),
      feedback.overallBand,
    );
    check("score_raw IS NULL", row.score_raw, null);
    check("score_total IS NULL", row.score_total, null);
    check(
      "answers.essay is stored VERBATIM",
      (row.answers as Record<string, unknown>).essay,
      SAMPLE_ESSAY,
    );
    ok(
      "ai_feedback_md carries the band and all four criteria",
      typeof row.ai_feedback_md === "string" &&
        row.ai_feedback_md.includes(`Overall band ${feedback.overallBand.toFixed(1)}`) &&
        ["TR", "CC", "LR", "GRA"].every((name) =>
          (row.ai_feedback_md as string).includes(`### ${name} —`),
        ),
      `ai_feedback_md was ${JSON.stringify(row.ai_feedback_md)}`,
    );

    console.log(
      `\n  Graded essay (${countWords(SAMPLE_ESSAY)} words) in ${seconds}s, ` +
        `${calls} model call(s).`,
    );
    console.log(
      `  Rough token usage: ~${roughTokens(promptChars)} in, ~${roughTokens(replyChars)} out ` +
        `(~${roughTokens(promptChars + replyChars)} total; chars/4, so ±20%).`,
    );
    console.log(`  Bands: ${feedback.criteria.map((c) => `${c.name} ${c.band}`).join("  ")}`);
    console.log(`  Overall: ${feedback.overallBand.toFixed(1)}`);
    for (const criterion of feedback.criteria) {
      console.log(`   - ${criterion.name}: ${criterion.comment}`);
    }
    for (const fix of feedback.topFixes) console.log(`   · fix: ${fix}`);

    // --- Phase 06 calibration: the same essay, old rubric vs new ---------------
    //
    // Soft on purpose. A model is not deterministic and a single run cannot
    // prove a calibration; what it can do is show whether the evidence-first
    // rubric and the LR cap actually moved this essay's numbers, which is the
    // question the ruling asked. Reported, never asserted.
    console.log("\n  --- Calibration: rubric v1 (Phase 05) vs v2 (Phase 06) ---");
    console.log(
      `  v1: ${PHASE_05_BASELINE.criteria
        .map(([name, band]) => `${name} ${band.toFixed(1)}`)
        .join("  ")}  →  overall ${PHASE_05_BASELINE.overall.toFixed(1)}`,
    );
    console.log(
      `  v2: ${feedback.criteria
        .map((c) => `${c.name} ${c.band.toFixed(1)}${c.capped ? "*" : ""}`)
        .join("  ")}  →  overall ${feedback.overallBand.toFixed(1)}`,
    );
    console.log(
      `  Overall moved ${(feedback.overallBand - PHASE_05_BASELINE.overall).toFixed(1)} band(s).` +
        " (* = clamped by code, not chosen by the model)",
    );
    console.log("  Error inventory, after the verbatim-in-essay filter:");
    for (const criterion of feedback.criteria) {
      console.log(
        `   - ${criterion.name} (${criterion.errors.length}): ` +
          (criterion.errors.length === 0
            ? "none"
            : criterion.errors.map((e) => JSON.stringify(e)).join(", ")),
      );
    }
    // The one property that IS asserted: every quote survives because it is
    // genuinely in the essay. The filter guarantees it; this proves the filter
    // ran against the live reply rather than a fixture.
    ok(
      "every quoted error is verbatim in the essay",
      feedback.criteria.every((c) => c.errors.every((e) => SAMPLE_ESSAY.includes(e))),
      "an error quote is not a substring of the essay",
    );
    ok(
      "the LR cap held: 3+ surviving errors means LR is not above 6.0",
      (() => {
        const lr = feedback.criteria[2];
        return lr.errors.length < 3 || lr.band <= 6.0;
      })(),
      `LR came back at ${feedback.criteria[2].band} with ${feedback.criteria[2].errors.length} errors`,
    );
    ok(
      "ai_feedback_md carries the error inventory when there is one",
      feedback.criteria.every(
        (c) =>
          c.errors.length === 0 ||
          (row.ai_feedback_md as string).includes(`- \`${c.errors[0]}\``),
      ),
      "a quoted error did not reach the stored markdown",
    );
  }

  // =========================================================================
  // 5. An under-length Task 2 gets a lengthNote.
  // =========================================================================
  {
    const socialTest = bank.find((t) => t.slug === "writing-t2-social-media");
    if (!socialTest) throw new Error("writing-t2-social-media is not seeded.");
    const socialTask = readEssayTask(socialTest.content);
    if (!socialTask) throw new Error("writing-t2-social-media has unusable content.");

    const feedback = await gradeEssay({
      taskType: socialTask.taskType,
      promptMd: socialTask.promptMd,
      essay: SHORT_TASK2_ESSAY,
      minWords: socialTask.minWords,
    });

    ok(
      `a ${countWords(SHORT_TASK2_ESSAY)}-word Task 2 gets a non-null lengthNote`,
      feedback.lengthNote !== null,
      "lengthNote came back null on an under-length essay",
    );
    console.log(`\n  lengthNote: ${feedback.lengthNote}`);
    console.log(`  TR on the under-length essay: ${feedback.criteria[0].band}`);
  }

  // =========================================================================
  // 6. Explain-my-answer: it explains, and it writes NOTHING.
  // =========================================================================
  {
    // Any committed bank reading test with a passage and a choice question.
    const { data: candidates, error: candError } = await supabase
      .from("tests")
      .select("id, slug, title, content")
      .eq("skill", "reading")
      .not("slug", "is", null)
      .order("slug", { ascending: true });
    if (candError) throw new Error(candError.message);

    let target: {
      testId: string;
      title: string;
      qnum: number;
      qtype: string;
      prompt: string;
      options: string[] | null;
      answerKey: string[];
      storedExplanation: string | null;
      passage: string;
      correctQnum: number;
    } | null = null;

    for (const test of candidates ?? []) {
      const content = test.content as Record<string, unknown>;
      const passage =
        typeof content?.passage_md === "string" ? content.passage_md : "";
      if (passage.trim() === "") continue;

      const { data: questions } = await supabase
        .from("questions")
        .select("qnum, qtype, prompt, options, answer_key, explanation_md")
        .eq("test_id", test.id as string)
        .order("qnum", { ascending: true });

      const usable = (questions ?? []).filter(
        (q) => Array.isArray(q.options) && (q.options as string[]).length > 1,
      );
      if (usable.length === 0) continue;

      const q = usable[0];
      target = {
        testId: test.id as string,
        title: test.title as string,
        qnum: q.qnum as number,
        qtype: q.qtype as string,
        prompt: q.prompt as string,
        options: q.options as string[],
        answerKey: q.answer_key as string[],
        storedExplanation: (q.explanation_md as string | null) ?? null,
        passage,
        correctQnum: q.qnum as number,
      };
      break;
    }

    if (!target) {
      failures.push("explain-my-answer: no bank reading test with options was found");
    } else {
      // A deliberately wrong answer: the first option that is not the key.
      const wrong =
        (target.options ?? []).find(
          (option) =>
            !target!.answerKey.some((key) => normalizeAnswer(key) === normalizeAnswer(option)),
        ) ?? "definitely not the answer";

      const attemptId = await startAttempt(target.testId);
      const { error: gradeError } = await supabase
        .from("attempts")
        .update({
          submitted_at: new Date().toISOString(),
          answers: { [String(target.qnum)]: wrong },
          score_raw: 0,
          score_total: 1,
          band_estimate: null,
        })
        .eq("id", attemptId);
      if (gradeError) throw new Error(gradeError.message);

      const before = snapshot(await readAttempt(attemptId));

      // Mirrors `explainMyAnswer`: identical prompt, identical filter.
      const explainPrompt = buildExplainPrompt({
          testTitle: target.title,
          passage: target.passage,
          qnum: target.qnum,
          qtype: target.qtype,
          prompt: target.prompt,
          options: target.options,
          answerKey: target.answerKey,
        storedExplanation: target.storedExplanation,
        given: wrong,
      });
      const explainPromptChars = explainPrompt.length;
      const raw = await textChat(explainPrompt, { maxCompletionTokens: 1_024 });
      const parsed = parseModelJson<{ explanation?: unknown }>(raw);
      const explanation =
        typeof parsed.explanation === "string" ? parsed.explanation.trim() : "";

      ok("explain: the model returned an explanation", explanation !== "", `raw: ${raw.slice(0, 200)}`);
      check("explain: it passes the rejection filter", explanationRejectionReason(explanation), null);
      ok(
        "explain: it references the answer the user actually gave",
        referencesAnswer(explanation, wrong),
        `given ${JSON.stringify(wrong)}, explanation: ${explanation}`,
      );
      ok(
        "explain: it addresses the student directly",
        /\byou(r)?\b/i.test(explanation),
        `explanation: ${explanation}`,
      );

      const after = snapshot(await readAttempt(attemptId));
      check("explain: the attempts row is BYTE-IDENTICAL afterwards", after, before);

      // And the guard that makes "correct questions get no button" a server
      // property rather than a UI convention: `explainMyAnswer` re-grades the
      // stored answer and refuses when it was right. Same comparison here.
      const isCorrect = (answer: string): boolean =>
        normalizeAnswer(answer) !== "" &&
        target!.answerKey.some((k) => normalizeAnswer(k) === normalizeAnswer(answer));
      check("explain: the wrong answer grades as wrong", isCorrect(wrong), false);
      check(
        "explain: the key grades as correct, so that question gets no button",
        isCorrect(target.answerKey[0]),
        true,
      );
      check("explain: an unanswered question is not 'correct'", isCorrect(""), false);

      console.log(`\n  explain-my-answer on "${target.title}" q${target.qnum}`);
      console.log(`   given: ${wrong}`);
      console.log(`   key:   ${target.answerKey.join(" · ")}`);
      console.log(`   → ${explanation}`);
      console.log(
        `   Rough token usage: ~${roughTokens(explainPromptChars)} in, ` +
          `~${roughTokens(raw.length)} out (chars/4).`,
      );
    }
  }

  // --- cleanup ---------------------------------------------------------------
  // The deck should hold the user's work, not the executor's fixtures.
  for (const attemptId of created) {
    if (untouchable.has(attemptId)) {
      failures.push(`cleanup refused: ${attemptId} existed before this run`);
      continue;
    }
    const { error } = await supabase.from("attempts").delete().eq("id", attemptId);
    if (error) failures.push(`cleanup failed for ${attemptId}: ${error.message}`);
  }

  const { data: afterAll } = await supabase.from("attempts").select("id");
  check(
    "every attempt this check created was deleted again",
    (afterAll ?? []).length,
    untouchable.size,
  );
}

main()
  .then(() => {
    if (failures.length > 0) {
      console.error(`\n${failures.length} live writing check(s) FAILED:\n`);
      for (const failure of failures) console.error(`  ✗ ${failure}\n`);
      process.exit(1);
    }
    console.log("\nAll live writing checks passed.");
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
