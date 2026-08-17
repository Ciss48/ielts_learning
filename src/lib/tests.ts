/**
 * Test player + objective grading — server-only.
 *
 * The security property this module exists to hold: `answer_key` and
 * `explanation_md` are selected from the database ONLY inside `submitAttempt`.
 * `getTestForUnit` — the one function that feeds the pre-submission UI — never
 * names those columns, so they cannot reach the client by accident, however the
 * player is refactored later.
 *
 * Grading is deliberately split in two: `gradeAnswers` is pure and exported for
 * `scripts/check_grading.ts`; `submitAttempt` wraps it with the I/O.
 */

import { createClient } from "@/lib/supabase/server";
import { rawToBand } from "@/lib/band";
import { normalizeAnswer } from "@/lib/normalize";
import { resolveAudioUrl } from "@/lib/r2";

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

export interface PlayerTest {
  id: string;
  skill: "reading" | "listening" | "writing";
  title: string;
  audioUrl: string | null;
  durationMinutes: number;
  content: { passage_md?: string; transcript_md?: string };
  questions: PlayerQuestion[];
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
    // Non-objective types (essay) are dropped rather than rendered wrong; the
    // page warns about them via `getUnsupportedQTypes`.
    questions: rows
      .filter((row) => isObjectiveQType(row.qtype))
      .map((row) => ({
        id: row.id,
        qnum: row.qnum,
        qtype: row.qtype as ObjectiveQType,
        prompt: row.prompt,
        options: toOptions(row.options),
      })),
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
      .select("test_id, score_raw, score_total")
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

  const best = new Map<string, { raw: number; total: number | null; count: number }>();
  for (const row of attemptsResult.data ?? []) {
    const testId = row.test_id as string;
    const raw = row.score_raw as number | null;
    const previous = best.get(testId);
    const count = (previous?.count ?? 0) + 1;
    if (raw === null) {
      best.set(testId, {
        raw: previous?.raw ?? -1,
        total: previous?.total ?? null,
        count,
      });
      continue;
    }
    if (!previous || raw > previous.raw) {
      best.set(testId, { raw, total: (row.score_total as number | null) ?? null, count });
    } else {
      best.set(testId, { ...previous, count });
    }
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
      attemptCount: scores?.count ?? 0,
    };
  });
}

/**
 * Additive to the locked contract: question types on this test that the Phase 02
 * player cannot render (only `essay` today — AI grading lands in Phase 5).
 * Kept off `PlayerTest` so the contract's shape is unchanged.
 */
export async function getUnsupportedQTypes(testId: string): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("questions")
    .select("qtype")
    .eq("test_id", testId);

  if (error) {
    throw new Error(
      `Failed to load question types for test ${testId}: ${error.message}`,
    );
  }

  return [
    ...new Set(
      (data ?? [])
        .map((row) => row.qtype as string)
        .filter((qtype) => !isObjectiveQType(qtype)),
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
