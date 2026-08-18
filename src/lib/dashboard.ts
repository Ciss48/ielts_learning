/**
 * Progress reporting — server-only.
 *
 * The three questions the dashboard answers, and the rule each one obeys:
 *
 *  1. **Where is each skill going?** `getSkillTrajectory` — one point per
 *     submitted attempt, oldest first, labelled with where it came from.
 *     Roadmap and bank attempts both appear: practice is practice. What they
 *     are NOT is averaged together into a single line, because a bank retry of
 *     a paper you have already seen is not the same evidence as a first sitting.
 *  2. **Which question types are weak?** `getQTypeBreakdown` — computed by
 *     RE-GRADING every stored answer through `gradeAnswers`, the same pure
 *     function the player grades with. Per-question results are deliberately
 *     not persisted (no schema change this phase, and none wanted): a second
 *     grading implementation living here would drift from the first one within
 *     a phase, and then the dashboard would quietly disagree with the review
 *     screen about whether an answer was right.
 *  3. **How much has been done?** `getTotals` — `study_log` for the roadmap
 *     numbers, `attempts` for the essay numbers.
 *
 * Every half of this module that decides a number is pure and exported, and
 * `scripts/check_dashboard.ts` pins it without a database. The functions with
 * `get` in front of them are the I/O around those.
 */

import { createClient } from "@/lib/supabase/server";
import { rawToBand } from "@/lib/band";
import { dayOfInstant, today } from "@/lib/day";
import {
  computeLongestStreak,
  computeStreak,
  type StudyLogRow,
} from "@/lib/stats";
import { gradeAnswers, type ObjectiveQType } from "@/lib/tests";

export type Skill = "reading" | "listening" | "writing";

// --- trajectories -------------------------------------------------------------

export interface TrajectoryPoint {
  attemptId: string;
  date: string; // Asia/Ho_Chi_Minh day via day.ts
  testTitle: string;
  source: "roadmap" | "bank";
  accuracyPct: number | null; // objective attempts
  band: number | null; // 40-q papers via rawToBand, or essay band_estimate
}

/** One submitted attempt, joined to the skill and title of its test. */
export interface AttemptForTrajectory {
  attemptId: string;
  submittedAt: string;
  unitId: string | null;
  skill: Skill;
  testTitle: string;
  scoreRaw: number | null;
  scoreTotal: number | null;
  bandEstimate: number | null;
}

/**
 * Pure. The two selection rules that are easy to get wrong and are therefore
 * fixtured:
 *
 *  - **Accuracy is for objective attempts only.** An essay has no fraction —
 *    `score_raw` is null by construction — so its `accuracyPct` is null rather
 *    than 0, which would draw a bar at the floor for a band 7 essay.
 *  - **A band is only shown where one exists.** For an objective attempt that
 *    means a full 40-question paper (`rawToBand` returns null otherwise, and a
 *    proportional band on a 13-question set would be invented); for an essay it
 *    means the stored `band_estimate`, which is the only result it has.
 */
export function buildTrajectory(
  attempts: AttemptForTrajectory[],
  skill: Skill,
): TrajectoryPoint[] {
  return attempts
    .filter((attempt) => attempt.skill === skill)
    .slice()
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
    .map((attempt) => {
      // `score_raw IS NULL` is what makes an attempt an essay one — the pair
      // `submitEssayAttempt` writes, and the same test Phase 05 handed over.
      const { scoreRaw, scoreTotal } = attempt;

      const accuracyPct =
        scoreRaw === null || scoreTotal === null || scoreTotal === 0
          ? null
          : Math.round((scoreRaw / scoreTotal) * 1000) / 10;

      const band =
        scoreRaw === null
          ? attempt.bandEstimate
          : skill === "writing"
            ? null // an objective writing test has no conversion table
            : rawToBand(skill, scoreRaw, scoreTotal ?? 0);

      return {
        attemptId: attempt.attemptId,
        date: dayOfInstant(attempt.submittedAt),
        testTitle: attempt.testTitle,
        source: attempt.unitId === null ? ("bank" as const) : ("roadmap" as const),
        accuracyPct,
        band,
      };
    });
}

/** Submitted attempts for one skill, oldest first. */
export async function getSkillTrajectory(skill: Skill): Promise<TrajectoryPoint[]> {
  return buildTrajectory(await loadSubmittedAttempts(), skill);
}

// --- question-type breakdown ---------------------------------------------------

export interface QTypeBreakdown {
  qtype: string;
  attempted: number;
  correct: number;
  accuracyPct: number;
}

/** One attempt's stored answers, beside the questions they were answers to. */
export interface AttemptForBreakdown {
  answers: Record<number, string>;
  questions: Array<{ qnum: number; qtype: ObjectiveQType; answerKey: string[] }>;
}

/**
 * Pure, and the whole point of it is the `gradeAnswers` call in the middle:
 * this function does no comparing of its own. It hands the stored answers and
 * the stored keys to the player's grader and counts what comes back, so
 * normalization, the whitespace-only rule and the accepted-variant rule can
 * only ever have one definition.
 *
 * **A question counts once per occurrence it was actually answered.** Sitting
 * the same paper twice counts twice — that is the point, a weakness that
 * survives a retry is a real one. A question left blank is not counted at all:
 * a blank is usually the clock running out, and folding it into "matching is
 * 40% accurate" would report a pacing problem as a comprehension one. It means
 * `attempted` is answered-occurrences, not presented-occurrences.
 */
export function buildQTypeBreakdown(attempts: AttemptForBreakdown[]): QTypeBreakdown[] {
  const tally = new Map<string, { attempted: number; correct: number }>();

  for (const attempt of attempts) {
    const qtypeByQnum = new Map(attempt.questions.map((q) => [q.qnum, q.qtype]));
    const { perQuestion } = gradeAnswers(attempt.questions, attempt.answers);

    for (const result of perQuestion) {
      if (result.given === "") continue;

      const qtype = qtypeByQnum.get(result.qnum);
      if (qtype === undefined) continue;

      const row = tally.get(qtype) ?? { attempted: 0, correct: 0 };
      row.attempted += 1;
      if (result.correct) row.correct += 1;
      tally.set(qtype, row);
    }
  }

  return [...tally.entries()]
    .map(([qtype, { attempted, correct }]) => ({
      qtype,
      attempted,
      correct,
      accuracyPct: Math.round((correct / attempted) * 1000) / 10,
    }))
    // Weakest first — the table exists to be read from the top. Ties go to the
    // one with more evidence behind it, so a 0/1 does not outrank a 3/12.
    .sort(
      (a, b) =>
        a.accuracyPct - b.accuracyPct ||
        b.attempted - a.attempted ||
        a.qtype.localeCompare(b.qtype),
    );
}

/**
 * Every submitted objective attempt, re-graded on read.
 *
 * Essay attempts are excluded by `score_raw IS NOT NULL`: there is no answer
 * key to re-grade an essay against, and its qtype would be a category of one.
 */
export async function getQTypeBreakdown(): Promise<QTypeBreakdown[]> {
  const supabase = await createClient();

  const { data: attemptRows, error: attemptsError } = await supabase
    .from("attempts")
    .select("id, test_id, answers")
    .not("submitted_at", "is", null)
    .not("score_raw", "is", null);

  if (attemptsError) {
    throw new Error(`Failed to load attempts: ${attemptsError.message}`);
  }

  const rows = (attemptRows ?? []) as Array<{
    id: string;
    test_id: string;
    answers: unknown;
  }>;
  if (rows.length === 0) return [];

  const testIds = [...new Set(rows.map((row) => row.test_id))];

  // The answer keys. `submitAttempt` is still the only place they are read to
  // GRADE a live submission; this reads them to re-grade an answer the user has
  // already seen the result of, and — like that function — never sends them
  // anywhere near a page that has not been submitted.
  const { data: questionRows, error: questionsError } = await supabase
    .from("questions")
    .select("test_id, qnum, qtype, answer_key")
    .in("test_id", testIds);

  if (questionsError) {
    throw new Error(`Failed to load answer keys: ${questionsError.message}`);
  }

  const questionsByTest = new Map<
    string,
    Array<{ qnum: number; qtype: ObjectiveQType; answerKey: string[] }>
  >();
  for (const row of questionRows ?? []) {
    const qtype = row.qtype as string;
    if (!isObjectiveQType(qtype)) continue;

    const testId = row.test_id as string;
    const list = questionsByTest.get(testId) ?? [];
    list.push({
      qnum: row.qnum as number,
      qtype,
      answerKey: toStringArray(row.answer_key),
    });
    questionsByTest.set(testId, list);
  }

  return buildQTypeBreakdown(
    rows.map((row) => ({
      answers: toAnswers(row.answers),
      questions: questionsByTest.get(row.test_id) ?? [],
    })),
  );
}

// --- totals --------------------------------------------------------------------

export interface Totals {
  unitsCompleted: number;
  totalMinutes: number;
  currentStreak: number;
  longestStreak: number;
  essaysGraded: number;
  avgWritingBand: number | null; // mean of band_estimate, 0.1 precision
}

/**
 * Pure. `study_log` is the only progress ledger and only `completeUnit` writes
 * to it, so the roadmap numbers come from there and nowhere else — counting
 * `unit_completions` rows instead would double-count nothing but would also
 * miss the minutes, and the two would drift.
 */
export function buildTotals(
  log: StudyLogRow[],
  essayBands: number[],
  end: string,
): Totals {
  const days = new Set(log.map((row) => row.day));

  return {
    unitsCompleted: log.reduce((sum, row) => sum + row.units_completed, 0),
    totalMinutes: log.reduce((sum, row) => sum + row.minutes, 0),
    currentStreak: computeStreak(days, end),
    longestStreak: computeLongestStreak(days),
    essaysGraded: essayBands.length,
    avgWritingBand:
      essayBands.length === 0
        ? null
        : Math.round(
            (essayBands.reduce((sum, band) => sum + band, 0) / essayBands.length) * 10,
          ) / 10,
  };
}

export async function getTotals(): Promise<Totals> {
  const supabase = await createClient();

  const [logResult, essayResult] = await Promise.all([
    supabase.from("study_log").select("day, minutes, units_completed"),
    // An essay attempt: graded (a band) but not scored (no fraction). Exactly
    // the pair `submitEssayAttempt` writes.
    supabase
      .from("attempts")
      .select("band_estimate")
      .not("submitted_at", "is", null)
      .is("score_raw", null)
      .not("band_estimate", "is", null),
  ]);

  if (logResult.error) {
    throw new Error(`Failed to load the study log: ${logResult.error.message}`);
  }
  if (essayResult.error) {
    throw new Error(`Failed to load essay attempts: ${essayResult.error.message}`);
  }

  const bands = (essayResult.data ?? [])
    .map((row) => toNumber(row.band_estimate))
    .filter((band): band is number => band !== null);

  return buildTotals((logResult.data ?? []) as StudyLogRow[], bands, today());
}

// --- shared I/O and coercion ---------------------------------------------------

/**
 * Every submitted attempt with the skill and title of its test.
 *
 * Two queries rather than a PostgREST embed, matching `listBankTests`: the
 * shapes an embed returns for a to-one relationship are easy to get subtly
 * wrong and impossible to fixture.
 */
async function loadSubmittedAttempts(): Promise<AttemptForTrajectory[]> {
  const supabase = await createClient();

  const { data: attemptRows, error: attemptsError } = await supabase
    .from("attempts")
    .select("id, unit_id, test_id, submitted_at, score_raw, score_total, band_estimate")
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: true });

  if (attemptsError) {
    throw new Error(`Failed to load attempts: ${attemptsError.message}`);
  }

  const rows = (attemptRows ?? []) as Array<{
    id: string;
    unit_id: string | null;
    test_id: string;
    submitted_at: string;
    score_raw: number | null;
    score_total: number | null;
    band_estimate: number | string | null;
  }>;
  if (rows.length === 0) return [];

  const { data: testRows, error: testsError } = await supabase
    .from("tests")
    .select("id, skill, title")
    .in("id", [...new Set(rows.map((row) => row.test_id))]);

  if (testsError) {
    throw new Error(`Failed to load tests: ${testsError.message}`);
  }

  const tests = new Map(
    (testRows ?? []).map((row) => [
      row.id as string,
      { skill: row.skill as Skill, title: row.title as string },
    ]),
  );

  return rows.flatMap((row) => {
    const test = tests.get(row.test_id);
    if (test === undefined) return [];

    return [
      {
        attemptId: row.id,
        submittedAt: row.submitted_at,
        unitId: row.unit_id,
        skill: test.skill,
        testTitle: test.title,
        scoreRaw: row.score_raw,
        scoreTotal: row.score_total,
        bandEstimate: toNumber(row.band_estimate),
      },
    ];
  });
}

const OBJECTIVE_QTYPES: readonly string[] = [
  "mcq",
  "tfng",
  "ynng",
  "matching",
  "gap_fill",
  "short_answer",
];

function isObjectiveQType(qtype: string): qtype is ObjectiveQType {
  return OBJECTIVE_QTYPES.includes(qtype);
}

/** `band_estimate` is `numeric(2,1)`; PostgREST hands numerics back as strings. */
function toNumber(value: number | string | null | unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}

/**
 * `attempts.answers` is jsonb, so its keys come back as strings — `{"3": "B"}`
 * — while `gradeAnswers` is keyed by number. An essay attempt stores
 * `{"essay": "..."}`, whose key is not a number at all and is dropped here.
 */
function toAnswers(raw: unknown): Record<number, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const answers: Record<number, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const qnum = Number(key);
    if (!Number.isInteger(qnum)) continue;
    if (typeof value !== "string") continue;
    answers[qnum] = value;
  }
  return answers;
}

// --- per-test attempt history ---------------------------------------------------

export interface TestAttempt {
  attemptId: string;
  date: string; // Asia/Ho_Chi_Minh day via day.ts
  source: "roadmap" | "bank";
  scoreRaw: number | null;
  scoreTotal: number | null;
  accuracyPct: number | null;
  bandEstimate: number | null;
  /**
   * `attempts.ai_feedback_md` — the whole essay review, rendered to markdown at
   * submission time. Phase 05 stored it precisely so this view can print it
   * rather than re-parse a feedback JSON blob and re-derive a band; re-deriving
   * would put a second copy of `computeOverallBand`'s rule in the codebase.
   * Null on every objective attempt.
   */
  feedbackMd: string | null;
}

/**
 * One test's submitted attempts, newest first.
 *
 * Read-only, and there is deliberately no delete or edit beside it: an attempt
 * is a record of what happened, and a history you can tidy up is not a history.
 */
export async function getTestAttempts(testId: string): Promise<TestAttempt[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("attempts")
    .select(
      "id, unit_id, submitted_at, score_raw, score_total, band_estimate, ai_feedback_md",
    )
    .eq("test_id", testId)
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load attempts for test ${testId}: ${error.message}`);
  }

  return ((data ?? []) as Array<{
    id: string;
    unit_id: string | null;
    submitted_at: string;
    score_raw: number | null;
    score_total: number | null;
    band_estimate: number | string | null;
    ai_feedback_md: string | null;
  }>).map((row) => ({
    attemptId: row.id,
    date: dayOfInstant(row.submitted_at),
    source: row.unit_id === null ? ("bank" as const) : ("roadmap" as const),
    scoreRaw: row.score_raw,
    scoreTotal: row.score_total,
    accuracyPct:
      row.score_raw === null || row.score_total === null || row.score_total === 0
        ? null
        : Math.round((row.score_raw / row.score_total) * 1000) / 10,
    bandEstimate: toNumber(row.band_estimate),
    feedbackMd: row.ai_feedback_md,
  }));
}
