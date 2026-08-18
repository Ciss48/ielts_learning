/**
 * The one content validator.
 *
 * Phase 02 kept this logic inside `scripts/seed.ts`. Phase 03 added a second
 * writer (`scripts/ingest_commit.ts`) carrying AI-extracted content, which is
 * exactly the content that most needs checking — so the rules live here and
 * every writer shares them. Seed files and staged files are different shapes
 * with the same core: a test is a test, a question is a question.
 *
 * Content is data, not code (CLAUDE.md): this module rejects malformed input
 * naming the exact field path. It never repairs, normalises or fills anything.
 *
 * Two hard rules apply to all content, seeded or ingested:
 *   1. For choice qtypes, every `answer_key` entry must equal one of `options`
 *      under the grader's normalization rule. Phase 02 verified this by hand
 *      for week_02; it is now enforced.
 *   2. `answer_key` must be non-empty at seed/commit time.
 * Staged files may violate both — `ingest.ts` records them as warnings so the
 * user can see what the model failed to extract — but committing them is
 * refused.
 *
 * Phase 05 inverts rule 2 for exactly one question type. An `essay` question is
 * graded by a model against the band descriptors, not by string comparison, so
 * it has no answer key at all: `answer_key` MUST be `[]` and `options` MUST be
 * null. A writing test is the whole task, so it carries exactly one such
 * question plus the task itself (`task_type` / `min_words` / `prompt_md`) in
 * `content`.
 */

import { normalizeAnswer } from "../../src/lib/normalize";

export const BLOCKS = [
  "diagnostic",
  "foundation",
  "skill_cycle",
  "mock",
  "taper",
] as const;

export const SKILLS = [
  "reading",
  "listening",
  "writing",
  "speaking",
  "vocab",
  "mixed",
] as const;

/** Mirrors the `tests.skill` check constraint (no speaking/vocab/mixed tests). */
export const TEST_SKILLS = ["reading", "listening", "writing"] as const;

/** Mirrors the `questions.qtype` check constraint. `essay` is valid content
 *  even though the Phase 02 player cannot render it yet (Phase 5 owns it). */
export const QTYPES = [
  "mcq",
  "tfng",
  "ynng",
  "matching",
  "gap_fill",
  "short_answer",
  "essay",
] as const;

/** Question types where the answer must be one of the printed options. */
export const CHOICE_QTYPES = ["mcq", "tfng", "ynng", "matching"] as const;

/**
 * The two IELTS writing tasks. Deliberately duplicated from
 * `src/lib/writing.ts` rather than imported: this module is loaded by
 * `seed.ts` / `ingest.ts` through a static import, and `writing.ts` reaches
 * `config.ts`, which reads `process.env` at module scope — before those scripts
 * have run `process.loadEnvFile`. Two string literals are a cheaper price than
 * an AI client that silently starts with no API key.
 */
export const WRITING_TASK_TYPES = ["task1", "task2"] as const;
export type WritingTaskType = (typeof WRITING_TASK_TYPES)[number];

/** Accepted range for a staged test's duration, in minutes. */
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 70;

export type Block = (typeof BLOCKS)[number];
export type Skill = (typeof SKILLS)[number];
export type TestSkill = (typeof TEST_SKILLS)[number];
export type QType = (typeof QTYPES)[number];

export interface SeedVocab {
  word: string;
  ipa: string | null;
  meaning_en: string | null;
  meaning_vi: string | null;
  example: string | null;
}

export interface SeedQuestion {
  qnum: number;
  qtype: QType;
  prompt: string;
  options: string[] | null;
  answer_key: string[];
  explanation_md: string | null;
}

export interface SeedTest {
  skill: TestSkill;
  title: string;
  duration_minutes: number;
  audio_url: string | null;
  content: Record<string, unknown>;
  questions: SeedQuestion[];
}

export interface SeedUnit {
  seq: number;
  block: Block;
  skill: Skill;
  title: string;
  est_minutes: number;
  elsa_task: string | null;
  strategy_md: string;
  vocab: SeedVocab[];
  /** An embedded test definition, or null. Mutually exclusive with `test_ref`. */
  test: SeedTest | null;
  /** The slug of a bank test to link instead of embedding one. */
  test_ref: string | null;
}

/** A bank test authored by hand in a seed file, rather than ingested. */
export interface SeedBankTest extends SeedTest {
  slug: string;
}

/** What a seed file may contain: roadmap units, bank tests, or both. */
export interface SeedFile {
  units: SeedUnit[];
  tests: SeedBankTest[];
}

export interface StagedTest {
  slug: string;
  skill: TestSkill;
  title: string;
  duration_minutes: number;
  /** Local audio filename in `content/raw/`, uploaded to R2 at commit time. */
  audio_file: string | null;
  content: { passage_md: string | null; transcript_md: string | null };
  questions: SeedQuestion[];
}

export interface StagedFile {
  source: string;
  extracted_at: string;
  tests: StagedTest[];
  warnings: string[];
}

export class ValidationError extends Error {}

export function fail(field: string, problem: string): never {
  throw new ValidationError(`Invalid content at \`${field}\`: ${problem}`);
}

/**
 * Where a rule violation goes. In `hard` mode it throws on the spot (the
 * seeder/committer aborts naming the field); in `soft` mode it is collected as
 * a warning so `ingest.ts` can still write a staged file the user can inspect.
 */
export interface ProblemSink {
  mode: "hard" | "soft";
  warnings: string[];
}

export function hardSink(): ProblemSink {
  return { mode: "hard", warnings: [] };
}

export function softSink(): ProblemSink {
  return { mode: "soft", warnings: [] };
}

function report(sink: ProblemSink, field: string, problem: string): void {
  if (sink.mode === "hard") fail(field, problem);
  sink.warnings.push(`\`${field}\`: ${problem}`);
}

// --- primitives --------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(field, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    fail(field, `expected a string or null, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function requirePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(field, `expected a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(field, `expected one of ${allowed.join(" | ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

export function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(field, `expected a non-empty array of strings, got ${JSON.stringify(value)}`);
  }
  return value.map((entry, i) => requireString(entry, `${field}[${i}]`));
}

export function optionalStringArray(value: unknown, field: string): string[] | null {
  if (value === undefined || value === null) return null;
  return requireStringArray(value, field);
}

/** Like `requireStringArray` but tolerates an empty array (staged answer keys). */
function stringArrayAllowingEmpty(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    fail(field, `expected an array of strings, got ${JSON.stringify(value)}`);
  }
  return value.map((entry, i) => requireString(entry, `${field}[${i}]`));
}

// --- questions ---------------------------------------------------------------

export function isChoiceQType(qtype: QType): boolean {
  return (CHOICE_QTYPES as readonly string[]).includes(qtype);
}

/**
 * The two cross-field rules. Structural parsing has already happened; this is
 * the part that decides whether the content is actually *gradeable*.
 */
function checkAnswerKeyRules(
  question: SeedQuestion,
  field: string,
  sink: ProblemSink,
): void {
  // Rule 2 — an unanswerable question cannot be graded.
  if (question.answer_key.length === 0) {
    report(sink, `${field}.answer_key`, "is empty — a graded question needs an answer key");
    // Nothing left to check against the options.
    return;
  }

  // Rule 1 — institutionalizes Phase 02 §4. The grader compares normalized
  // strings, so the validator must too, or content could pass here and still
  // be impossible to answer correctly in the player.
  if (!isChoiceQType(question.qtype) || question.options === null) return;

  const normalizedOptions = new Set(question.options.map(normalizeAnswer));
  question.answer_key.forEach((key, i) => {
    if (!normalizedOptions.has(normalizeAnswer(key))) {
      report(
        sink,
        `${field}.answer_key[${i}]`,
        `${JSON.stringify(key)} is not one of the ${question.qtype} options ` +
          `[${question.options?.map((o) => JSON.stringify(o)).join(", ")}] — ` +
          "a choice answer must be copied verbatim from that question's options",
      );
    }
  });
}

/**
 * The essay rules — rule 2 inverted. An essay is graded against the band
 * descriptors by `src/lib/writing.ts`, so a stored answer key could only ever be
 * a model answer masquerading as a key; the grader would then mark a perfectly
 * good essay wrong for not matching it. `options` is meaningless for the same
 * reason. `explanation_md` stays optional and is normally null: the feedback is
 * generated per attempt, not authored per question.
 */
function checkEssayRules(
  question: SeedQuestion,
  field: string,
  sink: ProblemSink,
): void {
  if (question.answer_key.length > 0) {
    report(
      sink,
      `${field}.answer_key`,
      `an essay question is graded against the band descriptors, not by string ` +
        `comparison — it must be [], got ${JSON.stringify(question.answer_key)}`,
    );
  }
  if (question.options !== null) {
    report(
      sink,
      `${field}.options`,
      `an essay question has no options — expected null, got ${JSON.stringify(question.options)}`,
    );
  }
}

export function parseQuestion(
  raw: unknown,
  field: string,
  sink: ProblemSink,
): SeedQuestion {
  if (!isRecord(raw)) fail(field, "expected an object");

  const question: SeedQuestion = {
    qnum: requirePositiveInt(raw.qnum, `${field}.qnum`),
    qtype: requireEnum(raw.qtype, `${field}.qtype`, QTYPES),
    prompt: requireString(raw.prompt, `${field}.prompt`),
    options: optionalStringArray(raw.options, `${field}.options`),
    // Shape is always checked; emptiness is a rule, so it goes through the sink.
    answer_key: stringArrayAllowingEmpty(raw.answer_key, `${field}.answer_key`),
    explanation_md: optionalString(raw.explanation_md, `${field}.explanation_md`),
  };

  if (question.qtype === "essay") {
    checkEssayRules(question, field, sink);
  } else {
    checkAnswerKeyRules(question, field, sink);
  }
  return question;
}

/** `questions` has a unique (test_id, qnum) constraint — catch clashes here,
 *  with the field path, rather than as a Postgres error mid-insert. */
function parseQuestionList(
  raw: unknown,
  field: string,
  sink: ProblemSink,
): SeedQuestion[] {
  if (!Array.isArray(raw)) fail(field, "expected an array");
  if (raw.length === 0) {
    fail(field, "is empty — a test needs at least one question");
  }

  const seenQnum = new Map<number, number>();
  return raw.map((q, i) => {
    const question = parseQuestion(q, `${field}[${i}]`, sink);
    const previous = seenQnum.get(question.qnum);
    if (previous !== undefined) {
      fail(
        `${field}[${i}].qnum`,
        `duplicate qnum ${question.qnum}, already used by ${field}[${previous}]`,
      );
    }
    seenQnum.set(question.qnum, i);
    return question;
  });
}

// --- seed files --------------------------------------------------------------

/** Lowercase, digits and single hyphens — it is a URL path segment (`/bank/<slug>`). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseVocab(raw: unknown, field: string): SeedVocab {
  if (!isRecord(raw)) fail(field, "expected an object");
  return {
    word: requireString(raw.word, `${field}.word`),
    ipa: optionalString(raw.ipa, `${field}.ipa`),
    meaning_en: optionalString(raw.meaning_en, `${field}.meaning_en`),
    meaning_vi: optionalString(raw.meaning_vi, `${field}.meaning_vi`),
    example: optionalString(raw.example, `${field}.example`),
  };
}

/**
 * A writing test IS its task, so the task lives on the test rather than in the
 * question prompt: `content.prompt_md` is what the candidate answers,
 * `min_words` is the length the band descriptors are read against, and
 * `task_type` decides whether TR means Task Response or Task Achievement.
 * Exactly one question, because there is exactly one essay to write — a second
 * one would have nowhere to store its own prompt or its own feedback.
 */
function checkWritingTestRules(
  test: SeedTest,
  field: string,
  sink: ProblemSink,
): void {
  if (test.skill !== "writing") return;

  if (test.questions.length !== 1) {
    report(
      sink,
      `${field}.questions`,
      `a writing test is one task and carries exactly one question, got ${test.questions.length}`,
    );
  }
  for (const [i, question] of test.questions.entries()) {
    if (question.qtype !== "essay") {
      report(
        sink,
        `${field}.questions[${i}].qtype`,
        `a writing test's question must be an essay, got ${JSON.stringify(question.qtype)}`,
      );
    }
  }

  const { task_type: taskType, min_words: minWords, prompt_md: promptMd } = test.content;

  if (
    typeof taskType !== "string" ||
    !(WRITING_TASK_TYPES as readonly string[]).includes(taskType)
  ) {
    report(
      sink,
      `${field}.content.task_type`,
      `expected one of ${WRITING_TASK_TYPES.join(" | ")}, got ${JSON.stringify(taskType)}`,
    );
  }
  if (typeof minWords !== "number" || !Number.isInteger(minWords) || minWords <= 0) {
    report(
      sink,
      `${field}.content.min_words`,
      `expected a positive integer, got ${JSON.stringify(minWords)}`,
    );
  }
  if (typeof promptMd !== "string" || promptMd.trim() === "") {
    report(
      sink,
      `${field}.content.prompt_md`,
      `expected a non-empty string — this is the task the candidate answers, got ${JSON.stringify(promptMd)}`,
    );
  }
}

function parseSeedTest(raw: unknown, field: string, sink: ProblemSink): SeedTest {
  if (!isRecord(raw)) fail(field, "expected an object");

  const content = raw.content ?? {};
  if (!isRecord(content)) fail(`${field}.content`, "expected an object");

  const test: SeedTest = {
    skill: requireEnum(raw.skill, `${field}.skill`, TEST_SKILLS),
    title: requireString(raw.title, `${field}.title`),
    duration_minutes: requirePositiveInt(
      raw.duration_minutes,
      `${field}.duration_minutes`,
    ),
    audio_url: optionalString(raw.audio_url, `${field}.audio_url`),
    content,
    questions: parseQuestionList(raw.questions, `${field}.questions`, sink),
  };

  checkWritingTestRules(test, field, sink);
  return test;
}

/**
 * A bank test authored in a seed file: the embedded-test shape plus the slug it
 * is addressed by (`/bank/<slug>`, and `test_ref` from a unit).
 */
function parseSeedBankTest(
  raw: unknown,
  field: string,
  sink: ProblemSink,
): SeedBankTest {
  if (!isRecord(raw)) fail(field, "expected an object");

  const slug = requireString(raw.slug, `${field}.slug`);
  if (!SLUG_PATTERN.test(slug)) {
    fail(
      `${field}.slug`,
      `${JSON.stringify(slug)} is not a valid slug — lowercase letters, digits and single hyphens only`,
    );
  }

  return { slug, ...parseSeedTest(raw, field, sink) };
}

/**
 * A seed file is architect-owned data, so it is always validated hard.
 *
 * It carries `units` (the roadmap), a top-level `tests` array (bank tests
 * authored by hand rather than ingested from a PDF), or both. A unit's `test`
 * (embedded) and `test_ref` (a bank slug) stay mutually exclusive; a `test_ref`
 * may name a slug defined in the same file's `tests`, because the seeder writes
 * the bank tests first.
 */
export function parseSeedFile(json: unknown): SeedFile {
  const sink = hardSink();

  if (!isRecord(json)) fail("<root>", "expected a JSON object");

  const hasUnits = json.units !== undefined && json.units !== null;
  const hasTests = json.tests !== undefined && json.tests !== null;
  if (!hasUnits && !hasTests) {
    fail("<root>", "expected a `units` array, a `tests` array, or both");
  }

  return {
    units: hasUnits ? parseSeedUnits(json.units, sink) : [],
    tests: hasTests ? parseSeedBankTests(json.tests, sink) : [],
  };
}

function parseSeedBankTests(raw: unknown, sink: ProblemSink): SeedBankTest[] {
  if (!Array.isArray(raw)) fail("tests", "expected an array");
  if (raw.length === 0) fail("tests", "is empty — omit the key rather than seeding nothing");

  const seenSlug = new Map<string, number>();
  return raw.map((entry, i) => {
    const test = parseSeedBankTest(entry, `tests[${i}]`, sink);
    const previous = seenSlug.get(test.slug);
    if (previous !== undefined) {
      fail(
        `tests[${i}].slug`,
        `duplicate slug ${JSON.stringify(test.slug)}, already used by tests[${previous}]`,
      );
    }
    seenSlug.set(test.slug, i);
    return test;
  });
}

function parseSeedUnits(rawUnits: unknown, sink: ProblemSink): SeedUnit[] {
  if (!Array.isArray(rawUnits)) fail("units", "expected an array");
  if (rawUnits.length === 0) fail("units", "is empty — nothing to seed");

  const seen = new Map<number, number>();

  return rawUnits.map((raw, i) => {
    const field = `units[${i}]`;
    if (!isRecord(raw)) fail(field, "expected an object");

    const seq = requirePositiveInt(raw.seq, `${field}.seq`);
    const previous = seen.get(seq);
    if (previous !== undefined) {
      fail(`${field}.seq`, `duplicate seq ${seq}, already used by units[${previous}]`);
    }
    seen.set(seq, i);

    const vocabRaw = raw.vocab ?? [];
    if (!Array.isArray(vocabRaw)) fail(`${field}.vocab`, "expected an array");

    // (unit_id, word) is the vocab upsert key (migration 0002), so the same word
    // twice in one unit would make the upsert affect a row twice. Reject it here.
    const vocab = vocabRaw.map((v, j) => parseVocab(v, `${field}.vocab[${j}]`));
    const seenWord = new Map<string, number>();
    vocab.forEach((v, j) => {
      const previousWord = seenWord.get(v.word);
      if (previousWord !== undefined) {
        fail(
          `${field}.vocab[${j}].word`,
          `duplicate word ${JSON.stringify(v.word)} in this unit, already used by ${field}.vocab[${previousWord}]`,
        );
      }
      seenWord.set(v.word, j);
    });

    const hasTest = raw.test !== undefined && raw.test !== null;
    const testRef = optionalString(raw.test_ref, `${field}.test_ref`);
    if (hasTest && testRef !== null) {
      fail(
        `${field}.test_ref`,
        "a unit carries either an embedded `test` object or a `test_ref` slug, never both",
      );
    }

    return {
      seq,
      block: requireEnum(raw.block, `${field}.block`, BLOCKS),
      skill: requireEnum(raw.skill, `${field}.skill`, SKILLS),
      title: requireString(raw.title, `${field}.title`),
      est_minutes: requirePositiveInt(raw.est_minutes, `${field}.est_minutes`),
      elsa_task: optionalString(raw.elsa_task, `${field}.elsa_task`),
      strategy_md: requireString(raw.strategy_md, `${field}.strategy_md`),
      vocab,
      test: hasTest ? parseSeedTest(raw.test, `${field}.test`, sink) : null,
      test_ref: testRef,
    };
  });
}

// --- staged files ------------------------------------------------------------

function parseStagedContent(
  raw: unknown,
  field: string,
): { passage_md: string | null; transcript_md: string | null } {
  const content = raw ?? {};
  if (!isRecord(content)) fail(field, "expected an object");
  return {
    passage_md: optionalString(content.passage_md, `${field}.passage_md`),
    transcript_md: optionalString(content.transcript_md, `${field}.transcript_md`),
  };
}

function parseStagedTest(
  raw: unknown,
  field: string,
  sink: ProblemSink,
): StagedTest {
  if (!isRecord(raw)) fail(field, "expected an object");

  const slug = requireString(raw.slug, `${field}.slug`);
  if (!SLUG_PATTERN.test(slug)) {
    fail(
      `${field}.slug`,
      `${JSON.stringify(slug)} is not a valid slug — lowercase letters, digits and single hyphens only`,
    );
  }

  const duration = requirePositiveInt(
    raw.duration_minutes,
    `${field}.duration_minutes`,
  );
  if (duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
    fail(
      `${field}.duration_minutes`,
      `${duration} is outside the accepted range ${MIN_DURATION_MINUTES}–${MAX_DURATION_MINUTES}`,
    );
  }

  return {
    slug,
    skill: requireEnum(raw.skill, `${field}.skill`, TEST_SKILLS),
    title: requireString(raw.title, `${field}.title`),
    duration_minutes: duration,
    audio_file: optionalString(raw.audio_file, `${field}.audio_file`),
    content: parseStagedContent(raw.content, `${field}.content`),
    questions: parseQuestionList(raw.questions, `${field}.questions`, sink),
  };
}

/**
 * Parse `content/staged/<basename>.json`.
 *
 * `mode: "soft"` is what `ingest.ts` uses right after extraction — rule
 * violations become warnings on the returned file so the review.md can show the
 * user exactly what the model got wrong. `mode: "hard"` is what
 * `ingest_commit.ts` uses, and it refuses to let those into the database.
 */
export function parseStagedFile(
  json: unknown,
  mode: "hard" | "soft",
): { file: StagedFile; warnings: string[] } {
  const sink: ProblemSink = { mode, warnings: [] };

  if (!isRecord(json)) fail("<root>", "expected a JSON object");

  const source = requireString(json.source, "source");
  const extractedAt = requireString(json.extracted_at, "extracted_at");

  if (!Array.isArray(json.tests)) fail("tests", "expected an array");
  if (json.tests.length === 0) {
    fail("tests", "is empty — nothing to commit");
  }

  const seenSlug = new Map<string, number>();
  const tests = json.tests.map((raw, i) => {
    const test = parseStagedTest(raw, `tests[${i}]`, sink);
    const previous = seenSlug.get(test.slug);
    if (previous !== undefined) {
      fail(
        `tests[${i}].slug`,
        `duplicate slug ${JSON.stringify(test.slug)}, already used by tests[${previous}]`,
      );
    }
    seenSlug.set(test.slug, i);
    return test;
  });

  const existingWarnings = Array.isArray(json.warnings)
    ? json.warnings.map((w, i) => requireString(w, `warnings[${i}]`))
    : [];

  return {
    file: {
      source,
      extracted_at: extractedAt,
      tests,
      warnings: existingWarnings,
    },
    // Warnings already in the file plus anything this pass found.
    warnings: [...existingWarnings, ...sink.warnings],
  };
}
