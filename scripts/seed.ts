/**
 * Content seeder — idempotent by `units.seq`.
 *
 *   npx tsx scripts/seed.ts content/seed/week_01.json
 *
 * Seed files are architect-owned data. This script validates and loads them
 * verbatim; it never rewrites, normalises or fills in content. A malformed file
 * aborts the run with the offending field path.
 *
 * Validation lives in `scripts/lib/validate.ts`, shared with
 * `scripts/ingest_commit.ts` so hand-authored and AI-extracted content are held
 * to exactly the same rules.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The seed script runs under plain `tsx`, outside Next.js, so nothing has
// populated process.env yet. Load .env.local before importing anything that
// pulls in src/lib/config.ts (which reads process.env at module scope).
process.loadEnvFile(resolve(process.cwd(), ".env.local"));

import { parseSeedFile, ValidationError } from "./lib/validate";

class SeedError extends Error {}

/** Both failure modes print the same way: one clear line, exit 1. */
function isExpectedError(err: unknown): err is Error {
  return err instanceof SeedError || err instanceof ValidationError;
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

  // --- Bank test references -------------------------------------------------
  // A unit may link a bank test by slug instead of embedding one. Resolve every
  // slug up front so an unknown one aborts before anything is written.
  const referencedSlugs = [
    ...new Set(units.map((u) => u.test_ref).filter((s): s is string => s !== null)),
  ];
  const testIdBySlug = new Map<string, string>();

  if (referencedSlugs.length > 0) {
    const { data: bankTests, error: bankError } = await supabase
      .from("tests")
      .select("id, slug")
      .in("slug", referencedSlugs);
    if (bankError) {
      throw new SeedError(`Could not resolve test_ref slugs: ${bankError.message}`);
    }
    for (const row of bankTests ?? []) {
      testIdBySlug.set(row.slug as string, row.id as string);
    }

    const unknown = referencedSlugs.filter((slug) => !testIdBySlug.has(slug));
    if (unknown.length > 0) {
      throw new SeedError(
        `Unknown test_ref slug(s): ${unknown.map((s) => JSON.stringify(s)).join(", ")}. ` +
          "Commit the staged file first with `npx tsx scripts/ingest_commit.ts …`, " +
          "or fix the slug in the seed file.",
      );
    }
  }

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
    // `test_id` is not in the payload, so an existing unit keeps whatever test
    // it is already linked to; reading it back tells us insert-vs-update below.
    .select("id, seq, test_id");

  if (unitsError) {
    throw new SeedError(`Failed to upsert units: ${unitsError.message}`);
  }

  const idBySeq = new Map<number, string>(
    (upserted ?? []).map((u) => [u.seq as number, u.id as string]),
  );
  const testIdBySeq = new Map<number, string | null>(
    (upserted ?? []).map((u) => [u.seq as number, (u.test_id as string | null) ?? null]),
  );

  function unitIdFor(seq: number): string {
    const unitId = idBySeq.get(seq);
    if (!unitId) {
      throw new SeedError(`Upsert did not return an id for unit seq ${seq}`);
    }
    return unitId;
  }

  // --- Vocab ----------------------------------------------------------------
  // Natural-key upsert on (unit_id, word) — migration 0002. An unchanged word
  // keeps its id, so the `vocab_cards` row hanging off it (SRS progress)
  // survives a re-seed. Only words dropped from the file are deleted, and
  // `vocab_cards.word_id` cascades, so those are the only ones worth warning on.
  let vocabCount = 0;
  for (const unit of units) {
    const unitId = unitIdFor(unit.seq);

    if (unit.vocab.length > 0) {
      const { error: upsertError } = await supabase.from("vocab_words").upsert(
        unit.vocab.map((v) => ({
          unit_id: unitId,
          word: v.word,
          ipa: v.ipa,
          meaning_en: v.meaning_en,
          meaning_vi: v.meaning_vi,
          example: v.example,
        })),
        { onConflict: "unit_id,word" },
      );
      if (upsertError) {
        throw new SeedError(
          `Failed to upsert vocab for unit seq ${unit.seq}: ${upsertError.message}`,
        );
      }
      vocabCount += unit.vocab.length;
    }

    const { data: existingWords, error: readWordsError } = await supabase
      .from("vocab_words")
      .select("id, word")
      .eq("unit_id", unitId);
    if (readWordsError) {
      throw new SeedError(
        `Failed to read vocab for unit seq ${unit.seq}: ${readWordsError.message}`,
      );
    }

    const keep = new Set(unit.vocab.map((v) => v.word));
    const staleIds = (existingWords ?? [])
      .filter((w) => !keep.has(w.word as string))
      .map((w) => w.id as string);

    if (staleIds.length > 0) {
      const { count } = await supabase
        .from("vocab_cards")
        .select("id", { count: "exact", head: true })
        .in("word_id", staleIds);
      if (count && count > 0) {
        console.warn(
          `WARNING: unit seq ${unit.seq} — ${staleIds.length} word(s) are no longer ` +
            `in the seed file; deleting them also removes ${count} vocab_cards ` +
            "row(s) (SRS progress).",
        );
      }

      const { error: deleteError } = await supabase
        .from("vocab_words")
        .delete()
        .in("id", staleIds);
      if (deleteError) {
        throw new SeedError(
          `Failed to prune vocab for unit seq ${unit.seq}: ${deleteError.message}`,
        );
      }
    }
  }

  // --- test_ref links -------------------------------------------------------
  // Linking only: a bank test is owned by `ingest_commit.ts`, so the seeder
  // never touches its row or its questions.
  let linkedCount = 0;
  for (const unit of units) {
    if (unit.test_ref === null) continue;

    const bankTestId = testIdBySlug.get(unit.test_ref);
    if (!bankTestId) {
      throw new SeedError(`Unknown test_ref slug ${JSON.stringify(unit.test_ref)}`);
    }

    if (testIdBySeq.get(unit.seq) !== bankTestId) {
      const { error: linkError } = await supabase
        .from("units")
        .update({ test_id: bankTestId })
        .eq("id", unitIdFor(unit.seq));
      if (linkError) {
        throw new SeedError(
          `Failed to link test_ref ${JSON.stringify(unit.test_ref)} to unit seq ${unit.seq}: ${linkError.message}`,
        );
      }
      testIdBySeq.set(unit.seq, bankTestId);
    }
    linkedCount += 1;
  }

  // --- Tests + questions ----------------------------------------------------
  // A test has no natural key, so its id is preserved explicitly: `attempts`
  // rows reference it and a re-seed must not orphan the user's history. A
  // `tests` row is therefore never deleted — only inserted or updated in place.
  let testCount = 0;
  let questionCount = 0;
  for (const unit of units) {
    if (!unit.test) continue;

    const unitId = unitIdFor(unit.seq);
    const payload = {
      skill: unit.test.skill,
      title: unit.test.title,
      duration_minutes: unit.test.duration_minutes,
      audio_url: unit.test.audio_url,
      content: unit.test.content,
    };

    let testId = testIdBySeq.get(unit.seq) ?? null;

    if (testId === null) {
      const { data: inserted, error: insertTestError } = await supabase
        .from("tests")
        .insert(payload)
        .select("id")
        .single();
      if (insertTestError) {
        throw new SeedError(
          `Failed to insert test for unit seq ${unit.seq}: ${insertTestError.message}`,
        );
      }
      testId = inserted.id as string;

      const { error: linkError } = await supabase
        .from("units")
        .update({ test_id: testId })
        .eq("id", unitId);
      if (linkError) {
        throw new SeedError(
          `Failed to link test to unit seq ${unit.seq}: ${linkError.message}`,
        );
      }
    } else {
      const { error: updateTestError } = await supabase
        .from("tests")
        .update(payload)
        .eq("id", testId);
      if (updateTestError) {
        throw new SeedError(
          `Failed to update test for unit seq ${unit.seq}: ${updateTestError.message}`,
        );
      }
    }

    // Questions carry no history of their own, so replacing them wholesale is
    // safe and keeps the file the single source of truth.
    const { error: clearError } = await supabase
      .from("questions")
      .delete()
      .eq("test_id", testId);
    if (clearError) {
      throw new SeedError(
        `Failed to clear questions for unit seq ${unit.seq}: ${clearError.message}`,
      );
    }

    const { error: insertQuestionsError } = await supabase.from("questions").insert(
      unit.test.questions.map((q) => ({
        test_id: testId,
        qnum: q.qnum,
        qtype: q.qtype,
        prompt: q.prompt,
        options: q.options,
        answer_key: q.answer_key,
        explanation_md: q.explanation_md,
      })),
    );
    if (insertQuestionsError) {
      throw new SeedError(
        `Failed to insert questions for unit seq ${unit.seq}: ${insertQuestionsError.message}`,
      );
    }

    testCount += 1;
    questionCount += unit.test.questions.length;
  }

  console.log(
    `Seeded ${units.length} units, ${vocabCount} vocab words, ` +
      `${testCount} test(s), ${questionCount} questions` +
      (linkedCount > 0 ? `, ${linkedCount} bank test link(s)` : ""),
  );
}

main().catch((err: unknown) => {
  if (isExpectedError(err)) {
    console.error(`\n${err.message}\n`);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
