/**
 * Content seeder — idempotent by `units.seq`.
 *
 *   npx tsx scripts/seed.ts content/seed/week_01.json
 *
 * Seed files are architect-owned data. This script validates and loads them
 * verbatim; it never rewrites, normalises or fills in content. A malformed file
 * aborts the run with the offending field path.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The seed script runs under plain `tsx`, outside Next.js, so nothing has
// populated process.env yet. Load .env.local before importing anything that
// pulls in src/lib/config.ts (which reads process.env at module scope).
process.loadEnvFile(resolve(process.cwd(), ".env.local"));

const BLOCKS = [
  "diagnostic",
  "foundation",
  "skill_cycle",
  "mock",
  "taper",
] as const;

const SKILLS = [
  "reading",
  "listening",
  "writing",
  "speaking",
  "vocab",
  "mixed",
] as const;

type Block = (typeof BLOCKS)[number];
type Skill = (typeof SKILLS)[number];

interface SeedVocab {
  word: string;
  ipa: string | null;
  meaning_en: string | null;
  meaning_vi: string | null;
  example: string | null;
}

interface SeedUnit {
  seq: number;
  block: Block;
  skill: Skill;
  title: string;
  est_minutes: number;
  elsa_task: string | null;
  strategy_md: string;
  vocab: SeedVocab[];
}

class SeedError extends Error {}

function fail(field: string, problem: string): never {
  throw new SeedError(`Invalid seed file at \`${field}\`: ${problem}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(field, `expected a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    fail(field, `expected a string or null, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requirePositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(field, `expected a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(field, `expected one of ${allowed.join(" | ")}, got ${JSON.stringify(value)}`);
  }
  return value as T;
}

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

function parseSeedFile(json: unknown): SeedUnit[] {
  if (!isRecord(json)) fail("<root>", "expected a JSON object");
  if (!Array.isArray(json.units)) fail("units", "expected an array");
  if (json.units.length === 0) fail("units", "is empty — nothing to seed");

  const seen = new Map<number, number>();

  return json.units.map((raw, i) => {
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

    return {
      seq,
      block: requireEnum(raw.block, `${field}.block`, BLOCKS),
      skill: requireEnum(raw.skill, `${field}.skill`, SKILLS),
      title: requireString(raw.title, `${field}.title`),
      est_minutes: requirePositiveInt(raw.est_minutes, `${field}.est_minutes`),
      elsa_task: optionalString(raw.elsa_task, `${field}.elsa_task`),
      strategy_md: requireString(raw.strategy_md, `${field}.strategy_md`),
      vocab: vocabRaw.map((v, j) => parseVocab(v, `${field}.vocab[${j}]`)),
    };
  });
}

async function main(): Promise<void> {
  const [, , fileArg] = process.argv;
  if (!fileArg) {
    throw new SeedError(
      "Usage: npx tsx scripts/seed.ts <path-to-seed.json>\n" +
        "   e.g. npx tsx scripts/seed.ts content/seed/week_01.json",
    );
  }

  const path = resolve(process.cwd(), fileArg);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new SeedError(
      `Could not read/parse ${fileArg}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const units = parseSeedFile(json);
  units.sort((a, b) => a.seq - b.seq);

  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const supabase = createAdminClient();

  // --- Roadmap pointer invariant -------------------------------------------
  // Existing units may be updated in place, but a *new* unit must never be
  // inserted at or behind the completed pointer (CLAUDE.md).
  const { data: existingUnits, error: existingError } = await supabase
    .from("units")
    .select("id, seq");
  if (existingError) {
    throw new SeedError(`Could not read existing units: ${existingError.message}`);
  }
  const existingSeqs = new Set((existingUnits ?? []).map((u) => u.seq as number));

  const { data: completions, error: completionsError } = await supabase
    .from("unit_completions")
    .select("unit_id");
  if (completionsError) {
    throw new SeedError(
      `Could not read unit_completions: ${completionsError.message}`,
    );
  }
  const completedIds = new Set((completions ?? []).map((c) => c.unit_id as string));
  const completedSeqs = (existingUnits ?? [])
    .filter((u) => completedIds.has(u.id as string))
    .map((u) => u.seq as number);
  const maxCompletedSeq = completedSeqs.length ? Math.max(...completedSeqs) : 0;

  const behindPointer = units.filter(
    (u) => !existingSeqs.has(u.seq) && u.seq <= maxCompletedSeq,
  );
  if (behindPointer.length > 0) {
    throw new SeedError(
      `Refusing to insert new unit(s) at seq ${behindPointer
        .map((u) => u.seq)
        .join(", ")}: the roadmap pointer has already passed seq ${maxCompletedSeq}. ` +
        "Give new units a seq above the highest completed one.",
    );
  }

  // --- Units ----------------------------------------------------------------
  // Upsert on the `seq` unique key. `id` is deliberately not supplied so an
  // existing row keeps its primary key — and therefore its completion row.
  const { data: upserted, error: unitsError } = await supabase
    .from("units")
    .upsert(
      units.map((u) => ({
        seq: u.seq,
        block: u.block,
        skill: u.skill,
        title: u.title,
        strategy_md: u.strategy_md,
        est_minutes: u.est_minutes,
        elsa_task: u.elsa_task,
      })),
      { onConflict: "seq" },
    )
    .select("id, seq");

  if (unitsError) {
    throw new SeedError(`Failed to upsert units: ${unitsError.message}`);
  }

  const idBySeq = new Map<number, string>(
    (upserted ?? []).map((u) => [u.seq as number, u.id as string]),
  );

  // --- Vocab ----------------------------------------------------------------
  // `vocab_cards.word_id` cascades on delete, so replacing a unit's words also
  // drops any SRS scheduling built on them (Phase 3). Warn rather than silently
  // discard review history.
  const targetUnitIds = [...idBySeq.values()];
  const { data: doomedWords } = await supabase
    .from("vocab_words")
    .select("id")
    .in("unit_id", targetUnitIds);
  const doomedIds = (doomedWords ?? []).map((w) => w.id as string);
  if (doomedIds.length > 0) {
    const { count } = await supabase
      .from("vocab_cards")
      .select("id", { count: "exact", head: true })
      .in("word_id", doomedIds);
    if (count && count > 0) {
      console.warn(
        `WARNING: re-seeding removes ${count} vocab_cards row(s) (SRS progress) ` +
          "because vocab_words are replaced. Re-run only if that is intended.",
      );
    }
  }

  // Delete-then-reinsert per unit, so re-running never duplicates rows.
  let vocabCount = 0;
  for (const unit of units) {
    const unitId = idBySeq.get(unit.seq);
    if (!unitId) {
      throw new SeedError(`Upsert did not return an id for unit seq ${unit.seq}`);
    }

    const { error: deleteError } = await supabase
      .from("vocab_words")
      .delete()
      .eq("unit_id", unitId);
    if (deleteError) {
      throw new SeedError(
        `Failed to clear vocab for unit seq ${unit.seq}: ${deleteError.message}`,
      );
    }

    if (unit.vocab.length === 0) continue;

    const { error: insertError } = await supabase.from("vocab_words").insert(
      unit.vocab.map((v) => ({
        unit_id: unitId,
        word: v.word,
        ipa: v.ipa,
        meaning_en: v.meaning_en,
        meaning_vi: v.meaning_vi,
        example: v.example,
      })),
    );
    if (insertError) {
      throw new SeedError(
        `Failed to insert vocab for unit seq ${unit.seq}: ${insertError.message}`,
      );
    }
    vocabCount += unit.vocab.length;
  }

  console.log(`Seeded ${units.length} units, ${vocabCount} vocab words`);
}

main().catch((err: unknown) => {
  if (err instanceof SeedError) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
