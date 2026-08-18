/**
 * Test player + objective grading — server-only.
 *
 * The security property this module exists to hold: `answer_key` and
 * `explanation_md` are selected from the database ONLY inside `submitAttempt`.
 * `getTestForUnit` — the one function that feeds the pre-submission UI — never
 * names those columns, so they cannot reach the client by accident, however the
 * player is refactored later. Phase 05's `submitEssayAttempt` does not weaken
 * that: an essay has no answer key (the validator enforces `answer_key: []`),
 * and that path never selects the column at all.
 *
 * Grading is deliberately split in two: `gradeAnswers` is pure and exported for
 * `scripts/check_grading.ts`; `submitAttempt` wraps it with the I/O. Essay
 * grading is the same split one module over: `src/lib/writing.ts` holds the
 * model call and the validation, and `submitEssayAttempt` below is its I/O.
 */

import { createClient } from "@/lib/supabase/server";
import { rawToBand } from "@/lib/band";
import { normalizeAnswer } from "@/lib/normalize";
import { resolveAudioUrl } from "@/lib/r2";
import { countWords } from "@/lib/words";
import {
  EssayTooShortError,
  MIN_ESSAY_WORDS,
  feedbackToMarkdown,
  gradeEssay,
  readEssayTask,
  type EssayTask,
  type WritingFeedback,
} from "@/lib/writing";

export type ObjectiveQType =
  | "mcq"
  | "tfng"
  | "ynng"
  | "matching"
  | "gap_fill"
  | "short_answer";

/** Everything in the schema's qtype check constraint minus `essay` (Phase 5). */
const OBJECTIVE_QTYPES: readonly ObjectiveQType[] = [
  "mcq",
  "tfng",
  "ynng",
  "matching",
  "gap_fill",
  "short_answer",
];

function isObjectiveQType(qtype: string): qtype is ObjectiveQType {
  return (OBJECTIVE_QTYPES as readonly string[]).includes(qtype);
}

/** Client-safe: NO answer_key, NO explanation_md. */
export interface PlayerQuestion {
  id: string;
  qnum: number;
  qtype: ObjectiveQType;
  prompt: string;
  options: string[] | null;
}

/**
 * The writing task, when this test is one. Additive to the Phase 02 contract:
 * `questions` still carries only objective questions, so every existing caller
 * is unchanged, and a player that does not know about essays simply sees a test
 * with no questions rather than a broken one.
 *
 * Client-safe by construction — an essay has no answer key to leak.
 */
export interface PlayerEssay {
  qnum: number;
  /** The question's own instruction line ("Write your essay in response…"). */
  prompt: string;
  taskType: "task1" | "task2";
  minWords: number;
  /** The task itself, markdown, tables included. */
  promptMd: string;
}

export interface PlayerTest {
  id: string;
  skill: "reading" | "listening" | "writing";
  title: string;
  audioUrl: string | null;
  durationMinutes: number;
  content: { passage_md?: string; transcript_md?: string };
  questions: PlayerQuestion[];
  essay: PlayerEssay | null;
}

export interface PerQuestionResult {
  qnum: number;
  correct: boolean;
  given: string;
  expected: string[];
  explanationMd: string | null;
}

export interface GradedAttempt {
  attemptId: string;
  scoreRaw: number;
  scoreTotal: number;
  bandEstimate: number | null;
  perQuestion: PerQuestionResult[];
}

/** Columns safe to send to the browser before submission. */
const PLAYER_QUESTION_COLUMNS = "id, qnum, qtype, prompt, options";
const TEST_COLUMNS = "id, skill, title, audio_url, duration_minutes, content";

interface TestRow {
  id: string;
  skill: "reading" | "listening" | "writing";
  title: string;
  audio_url: string | null;
  duration_minutes: number;
  content: unknown;
}

interface PlayerQuestionRow {
  id: string;
  qnum: number;
  qtype: string;
  prompt: string;
  options: unknown;
}

/** `content` is jsonb, so it is `unknown` until proven otherwise. */
function toContent(raw: unknown): { passage_md?: string; transcript_md?: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const record = raw as Record<string, unknown>;
  const content: { passage_md?: string; transcript_md?: string } = {};
  if (typeof record.passage_md === "string") content.passage_md = record.passage_md;
  if (typeof record.transcript_md === "string") {
    content.transcript_md = record.transcript_md;
  }
  return content;
}

/** `options` is jsonb; a non-array (or an absent value) means "not a choice question". */
function toOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options = raw.filter((o): o is string => typeof o === "string");
  return options.length > 0 ? options : null;
}

function toAnswerKey(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((k): k is string => typeof k === "string");
}

/**
 * Shared by the roadmap player and the bank player. Selects the client-safe
 * columns only, and turns a private `r2:` audio key into a presigned URL — the
 * raw key never leaves the server.
 */
async function toPlayerTest(test: TestRow): Promise<PlayerTest> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("questions")
    .select(PLAYER_QUESTION_COLUMNS)
    .eq("test_id", test.id)
    .order("qnum", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load questions for test ${test.id}: ${error.message}`,
    );
  }

  const rows = (data ?? []) as PlayerQuestionRow[];

  return {
    id: test.id,
    skill: test.skill,
    title: test.title,
    audioUrl: await resolveAudioUrl(test.audio_url),
    durationMinutes: test.duration_minutes,
    content: toContent(test.content),
    // Objective questions only. An essay is not one of them and is carried on
    // `essay` below instead; any OTHER non-objective type is still dropped
    // rather than rendered wrong, and the page warns about it via
    // `getUnsupportedQTypes`.
    questions: rows
      .filter((row) => isObjectiveQType(row.qtype))
      .map((row) => ({
        id: row.id,
        qnum: row.qnum,
        qtype: row.qtype as ObjectiveQType,
        prompt: row.prompt,
        options: toOptions(row.options),
      })),
    essay: toPlayerEssay(test, rows),
  };
}

/**
 * A writing test is exactly one essay question plus the task in `content`
 * (enforced by the validator). If either half is missing the row is not a
 * playable writing test, and returning null gives the "unsupported question
 * type" warning rather than a panel with no prompt in it.
 */
function toPlayerEssay(test: TestRow, rows: PlayerQuestionRow[]): PlayerEssay | null {
  if (test.skill !== "writing") return null;

  const essayRow = rows.find((row) => row.qtype === "essay");
  if (!essayRow) return null;

  const task = readEssayTask(test.content);
  if (task === null) return null;

  return {
    qnum: essayRow.qnum,
    prompt: essayRow.prompt,
    taskType: task.taskType,
    minWords: task.minWords,
    promptMd: task.promptMd,
  };
}

export async function getTestForUnit(testId: string): Promise<PlayerTest | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tests")
    .select(TEST_COLUMNS)
    .eq("id", testId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load test ${testId}: ${error.message}`);
  }
  if (!data) return null;

  return toPlayerTest(data as TestRow);
}

/** The practice-library read: a bank test addressed by its slug. */
export async function getTestBySlug(slug: string): Promise<PlayerTest | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tests")
    .select(TEST_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load test "${slug}": ${error.message}`);
  }
  if (!data) return null;

  return toPlayerTest(data as TestRow);
}

export interface BankTestSummary {
  id: string;
  slug: string;
  skill: "reading" | "listening" | "writing";
  title: string;
  durationMinutes: number;
  questionCount: number;
  /** Best score across all submitted attempts, or null if never attempted. */
  bestScoreRaw: number | null;
  scoreTotal: number | null;
  /**
   * Best band across all submitted attempts. A writing test has no raw score at
   * all — the essay is graded against the descriptors — so this is the only
   * result it has to show.
   */
  bestBandEstimate: number | null;
  attemptCount: number;
}

/**
 * Every test with a slug — i.e. the bank. Roadmap-embedded tests have a null
 * slug and are deliberately excluded: they belong to a unit, not the library.
 */
export async function listBankTests(): Promise<BankTestSummary[]> {
  const supabase = await createClient();

  const { data: tests, error } = await supabase
    .from("tests")
    .select("id, slug, skill, title, duration_minutes")
    .not("slug", "is", null)
    .order("slug", { ascending: true });

  if (error) {
    throw new Error(`Failed to load the test bank: ${error.message}`);
  }

  const rows = (tests ?? []) as Array<{
    id: string;
    slug: string;
    skill: "reading" | "listening" | "writing";
    title: string;
    duration_minutes: number;
  }>;
  if (rows.length === 0) return [];

  const ids = rows.map((t) => t.id);

  const [questionsResult, attemptsResult] = await Promise.all([
    supabase.from("questions").select("test_id").in("test_id", ids),
    supabase
      .from("attempts")
      .select("test_id, score_raw, score_total, band_estimate")
      .in("test_id", ids)
      .not("submitted_at", "is", null),
  ]);

  if (questionsResult.error) {
    throw new Error(
      `Failed to count bank questions: ${questionsResult.error.message}`,
    );
  }
  if (attemptsResult.error) {
    throw new Error(
      `Failed to load bank attempts: ${attemptsResult.error.message}`,
    );
  }

  const questionCounts = new Map<string, number>();
  for (const row of questionsResult.data ?? []) {
    const testId = row.test_id as string;
    questionCounts.set(testId, (questionCounts.get(testId) ?? 0) + 1);
  }

  interface Best {
    raw: number;
    total: number | null;
    band: number | null;
    count: number;
  }
  const best = new Map<string, Best>();
  for (const row of attemptsResult.data ?? []) {
    const testId = row.test_id as string;
    const raw = row.score_raw as number | null;
    // `band_estimate` is numeric(2,1); PostgREST hands numerics back as strings.
    const bandRaw = row.band_estimate as number | string | null;
    const band = bandRaw === null ? null : Number(bandRaw);

    const previous = best.get(testId);
    const count = (previous?.count ?? 0) + 1;
    const bestBand =
      band !== null && Number.isFinite(band)
        ? Math.max(band, previous?.band ?? band)
        : (previous?.band ?? null);

    if (raw === null || (previous && raw <= previous.raw)) {
      best.set(testId, {
        raw: previous?.raw ?? -1,
        total: previous?.total ?? null,
        band: bestBand,
        count,
      });
      continue;
    }
    best.set(testId, {
      raw,
      total: (row.score_total as number | null) ?? null,
      band: bestBand,
      count,
    });
  }

  return rows.map((test) => {
    const scores = best.get(test.id);
    return {
      id: test.id,
      slug: test.slug,
      skill: test.skill,
      title: test.title,
      durationMinutes: test.duration_minutes,
      questionCount: questionCounts.get(test.id) ?? 0,
      bestScoreRaw: scores && scores.raw >= 0 ? scores.raw : null,
      scoreTotal: scores && scores.raw >= 0 ? scores.total : null,
      bestBandEstimate: scores?.band ?? null,
      attemptCount: scores?.count ?? 0,
    };
  });
}

/**
 * Additive to the locked contract: question types on this test that the player
 * cannot render. Kept off `PlayerTest` so the contract's shape is unchanged.
 *
 * Since Phase 05 an `essay` on a writing test is supported — it is played
 * through `PlayerTest.essay` — so it is not reported here. An `essay` sitting on
 * a reading or listening test still is: nothing can render it there.
 */
export async function getUnsupportedQTypes(testId: string): Promise<string[]> {
  const supabase = await createClient();

  const [testResult, questionsResult] = await Promise.all([
    supabase.from("tests").select("skill").eq("id", testId).maybeSingle(),
    supabase.from("questions").select("qtype").eq("test_id", testId),
  ]);

  if (questionsResult.error) {
    throw new Error(
      `Failed to load question types for test ${testId}: ${questionsResult.error.message}`,
    );
  }
  if (testResult.error) {
    throw new Error(`Failed to load test ${testId}: ${testResult.error.message}`);
  }

  const isWriting = testResult.data?.skill === "writing";

  return [
    ...new Set(
      (questionsResult.data ?? [])
        .map((row) => row.qtype as string)
        .filter((qtype) => !isObjectiveQType(qtype))
        .filter((qtype) => !(isWriting && qtype === "essay")),
    ),
  ];
}

/**
 * `unitId` is null for a bank attempt (`/bank/[slug]`): practice outside the
 * roadmap is recorded, but it belongs to no unit, so it can never be mistaken
 * for roadmap progress. Grading is identical either way.
 */
export async function startAttempt(
  unitId: string | null,
  testId: string,
): Promise<{ attemptId: string; startedAt: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attempts")
    .insert({ unit_id: unitId, test_id: testId })
    .select("id, started_at")
    .single();

  if (error) {
    throw new Error(`Failed to start attempt for test ${testId}: ${error.message}`);
  }

  return {
    attemptId: data.id as string,
    startedAt: data.started_at as string,
  };
}

/**
 * Normalization applied to BOTH sides before comparison:
 * trim → lowercase → collapse internal whitespace to single spaces.
 *
 * Defined in `@/lib/normalize` since Phase 03, because the content validator
 * (`scripts/lib/validate.ts`) checks answer keys against options using this
 * exact rule — the two must never drift apart.
 */
const normalize = normalizeAnswer;

/** Pure, exported for the fixture check script. */
export function gradeAnswers(
  questions: Array<{ qnum: number; qtype: ObjectiveQType; answerKey: string[] }>,
  answers: Record<number, string>,
): {
  scoreRaw: number;
  scoreTotal: number;
  perQuestion: Array<{ qnum: number; correct: boolean; given: string }>;
} {
  const perQuestion = questions.map((question) => {
    const submitted = answers[question.qnum];
    // Whitespace-only counts as unanswered; `given` is what the review screen
    // shows back to the user, so it is trimmed but otherwise verbatim.
    const given = typeof submitted === "string" ? submitted.trim() : "";
    const normalized = normalize(given);

    const correct =
      normalized !== "" &&
      question.answerKey.some((key) => normalize(key) === normalized);

    return { qnum: question.qnum, correct, given };
  });

  return {
    scoreRaw: perQuestion.filter((result) => result.correct).length,
    scoreTotal: questions.length,
    perQuestion,
  };
}

/**
 * Grades server-side, updates the attempt row (submitted_at, answers,
 * score_raw, score_total, band_estimate), returns the full review payload.
 */
export async function submitAttempt(
  attemptId: string,
  answers: Record<number, string>,
): Promise<GradedAttempt> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .from("attempts")
    .select("id, test_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    throw new Error(`Failed to load attempt ${attemptId}: ${attemptError.message}`);
  }
  if (!attempt) {
    throw new Error(`No attempt with id ${attemptId}`);
  }
  const testId = attempt.test_id as string;

  // The only place answer_key / explanation_md are ever read.
  const [testResult, questionsResult] = await Promise.all([
    supabase.from("tests").select("id, skill").eq("id", testId).maybeSingle(),
    supabase
      .from("questions")
      .select("qnum, qtype, answer_key, explanation_md")
      .eq("test_id", testId)
      .order("qnum", { ascending: true }),
  ]);

  if (testResult.error) {
    throw new Error(`Failed to load test ${testId}: ${testResult.error.message}`);
  }
  if (questionsResult.error) {
    throw new Error(
      `Failed to load answer key for test ${testId}: ${questionsResult.error.message}`,
    );
  }
  if (!testResult.data) {
    throw new Error(`Attempt ${attemptId} references missing test ${testId}`);
  }

  const skill = testResult.data.skill as "reading" | "listening" | "writing";

  const graded = (questionsResult.data ?? [])
    .filter((row) => isObjectiveQType(row.qtype as string))
    .map((row) => ({
      qnum: row.qnum as number,
      qtype: row.qtype as ObjectiveQType,
      answerKey: toAnswerKey(row.answer_key),
      explanationMd: (row.explanation_md as string | null) ?? null,
    }));

  const { scoreRaw, scoreTotal, perQuestion } = gradeAnswers(graded, answers);

  // Writing has no objective raw→band table; only reading and listening do.
  const bandEstimate =
    skill === "writing" ? null : rawToBand(skill, scoreRaw, scoreTotal);

  const { error: updateError } = await supabase
    .from("attempts")
    .update({
      submitted_at: new Date().toISOString(),
      answers,
      score_raw: scoreRaw,
      score_total: scoreTotal,
      band_estimate: bandEstimate,
    })
    .eq("id", attemptId);

  if (updateError) {
    throw new Error(
      `Failed to save attempt ${attemptId}: ${updateError.message}`,
    );
  }

  const byQnum = new Map(graded.map((q) => [q.qnum, q]));

  return {
    attemptId,
    scoreRaw,
    scoreTotal,
    bandEstimate,
    perQuestion: perQuestion.map((result) => ({
      ...result,
      expected: byQnum.get(result.qnum)?.answerKey ?? [],
      explanationMd: byQnum.get(result.qnum)?.explanationMd ?? null,
    })),
  };
}

// --- essays ------------------------------------------------------------------

/**
 * Grade one essay attempt and store the result.
 *
 * Three things this deliberately does NOT do:
 *  - It never reads or writes `answer_key`. An essay has none (the validator
 *    enforces `answer_key: []`), so the Phase 02 split — keys are read in
 *    exactly one function — is untouched.
 *  - It never writes `score_raw` / `score_total`. A four-criteria band is not a
 *    fraction, and leaving them null is what tells `/bank` and Phase 6 to show a
 *    band instead of a score.
 *  - It never re-grades. One grade per attempt; trying again is a new attempt.
 *
 * Under `MIN_ESSAY_WORDS` it throws `EssayTooShortError` BEFORE the model call
 * and before any write, so the attempt stays unsubmitted and no tokens are
 * spent.
 */
export async function submitEssayAttempt(
  attemptId: string,
  essay: string,
): Promise<{ feedback: WritingFeedback }> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .from("attempts")
    .select("id, test_id, submitted_at")
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    throw new Error(`Failed to load attempt ${attemptId}: ${attemptError.message}`);
  }
  if (!attempt) {
    throw new Error(`No attempt with id ${attemptId}`);
  }
  if (attempt.submitted_at !== null) {
    throw new Error(
      `Attempt ${attemptId} has already been submitted. One grade per attempt — ` +
        "start a new attempt to write this task again.",
    );
  }

  const testId = attempt.test_id as string;
  const task = await getEssayTask(testId);

  // The refusal, before the model call and before any write.
  const words = countWords(essay);
  if (words < MIN_ESSAY_WORDS) {
    throw new EssayTooShortError(words);
  }

  const feedback = await gradeEssay({
    taskType: task.taskType,
    promptMd: task.promptMd,
    essay,
    minWords: task.minWords,
  });

  const { error: updateError } = await supabase
    .from("attempts")
    .update({
      submitted_at: new Date().toISOString(),
      // Verbatim: what was written is the record, and Phase 6 shows it back.
      answers: { essay },
      score_raw: null,
      score_total: null,
      band_estimate: feedback.overallBand,
      ai_feedback_md: feedbackToMarkdown(feedback, task),
    })
    .eq("id", attemptId);

  if (updateError) {
    throw new Error(`Failed to save essay attempt ${attemptId}: ${updateError.message}`);
  }

  return { feedback };
}

/** The writing task behind a test id, or a thrown error naming what is wrong. */
async function getEssayTask(testId: string): Promise<EssayTask> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tests")
    .select("id, skill, content")
    .eq("id", testId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load test ${testId}: ${error.message}`);
  if (!data) throw new Error(`No test with id ${testId}`);
  if (data.skill !== "writing") {
    throw new Error(
      `Test ${testId} is a ${data.skill} test — essays are only graded on writing tests.`,
    );
  }

  const task = readEssayTask(data.content);
  if (task === null) {
    throw new Error(
      `Test ${testId} is a writing test but its content is missing a usable ` +
        "`task_type`, `min_words` or `prompt_md`. Re-seed it from content/seed/.",
    );
  }
  return task;
}
