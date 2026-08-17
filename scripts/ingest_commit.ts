/**
 * Staged JSON → the test bank. The ONLY path from ingestion into the database.
 *
 *   npx tsx scripts/ingest_commit.ts content/staged/<basename>.json
 *
 * `scripts/ingest.ts` writes drafts and never touches the database; this script
 * is the separate, human-initiated step that commits one after the user has
 * read its review.md (CLAUDE.md: AI-extracted content is never auto-inserted).
 *
 * Discipline inherited from Phase 02: a `tests` row is never deleted, because
 * `attempts` reference it. A slug that already exists is UPDATED in place, so
 * its id — and the user's attempt history — survives re-committing. Questions
 * carry no history and are replaced wholesale.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

process.loadEnvFile(resolve(process.cwd(), ".env.local"));

import { parseStagedFile, ValidationError, type StagedTest } from "./lib/validate";

const RAW_DIR = resolve(process.cwd(), "content/raw");

class CommitError extends Error {}

function isExpectedError(err: unknown): err is Error {
  return err instanceof CommitError || err instanceof ValidationError;
}

interface CommitRow {
  slug: string;
  action: "inserted" | "updated";
  questions: number;
  audio: string;
}

function summaryTable(rows: CommitRow[]): string {
  const headers = ["slug", "action", "questions", "audio"];
  const cells = rows.map((r) => [r.slug, r.action, String(r.questions), r.audio]);
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...cells.map((row) => row[i].length)),
  );

  const line = (values: string[]) =>
    values.map((value, i) => value.padEnd(widths[i])).join("  ");

  return [
    line(headers),
    widths.map((w) => "-".repeat(w)).join("  "),
    ...cells.map(line),
  ].join("\n");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find((arg) => !arg.startsWith("--"));

  // `--skip` leaves a staged test out of this commit without editing the staged
  // file. A staged file routinely contains one task the user has decided not to
  // commit — an answer key the extraction model invented, or a "choose TWO
  // letters" task the schema cannot represent — and deleting it from the JSON
  // would destroy the record of what was extracted. Naming it on the command
  // line keeps the decision visible in the console output and in the report.
  const skipArg = args.find((arg) => arg.startsWith("--skip="));
  const skip = new Set(
    (skipArg?.slice("--skip=".length) ?? "")
      .split(",")
      .map((slug) => slug.trim())
      .filter((slug) => slug !== ""),
  );

  if (!fileArg) {
    throw new CommitError(
      "Usage: npx tsx scripts/ingest_commit.ts <path-to-staged.json> [--skip=<slug>,<slug>]\n" +
        "   e.g. npx tsx scripts/ingest_commit.ts content/staged/cam18-test1-reading.json",
    );
  }

  const path = resolve(process.cwd(), fileArg);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CommitError(
      `Could not read/parse ${fileArg}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Hard rules: an empty answer key or a choice answer that is not one of the
  // printed options aborts here, naming the field path. Nothing is written.
  const { file } = parseStagedFile(json, "hard");

  const unknownSkips = [...skip].filter(
    (slug) => !file.tests.some((test) => test.slug === slug),
  );
  if (unknownSkips.length > 0) {
    throw new CommitError(
      `--skip names ${unknownSkips.map((s) => `"${s}"`).join(", ")}, which ` +
        `${unknownSkips.length === 1 ? "is" : "are"} not in ${basename(path)}. ` +
        "Nothing was written — check the slug(s) against the review file.",
    );
  }

  const staged = file.tests;
  file.tests = staged.filter((test) => !skip.has(test.slug));

  console.log(
    `Committing ${file.tests.length} of ${staged.length} test(s) from ${basename(path)} ` +
      `(source: ${file.source})`,
  );
  for (const slug of skip) {
    console.log(`  - skipping "${slug}" (--skip): left staged, not written to the database.`);
  }
  if (file.warnings.length > 0) {
    console.log(
      `  note: the staged file carries ${file.warnings.length} warning(s) from extraction — ` +
        "they did not violate a hard rule.",
    );
  }

  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const supabase = createAdminClient();

  // --- audio ----------------------------------------------------------------
  const withAudio = file.tests.filter((t) => t.audio_file !== null);
  let r2Ready = false;
  if (withAudio.length > 0) {
    const { isR2Configured, missingR2Vars } = await import("../src/lib/r2");
    r2Ready = isR2Configured();
    if (!r2Ready) {
      console.log(
        `  ! R2 is not configured (missing ${missingR2Vars().join(", ")}) — ` +
          `${withAudio.length} audio file(s) will be skipped and audio_url left null.`,
      );
    }
  }

  async function commitAudio(test: StagedTest): Promise<string | null> {
    if (test.audio_file === null) return null;
    if (!r2Ready) return null;

    const audioPath = join(RAW_DIR, test.audio_file);
    if (!existsSync(audioPath)) {
      console.log(
        `  ! ${test.slug}: audio file content/raw/${test.audio_file} not found — skipped.`,
      );
      return null;
    }

    const { uploadToR2, R2_URL_PREFIX } = await import("../src/lib/r2");
    const key = `audio/${test.slug}.mp3`;
    await uploadToR2(key, readFileSync(audioPath), "audio/mpeg");
    // The bucket stays private; the app presigns this key at render time.
    return `${R2_URL_PREFIX}${key}`;
  }

  // --- tests + questions ----------------------------------------------------
  const rows: CommitRow[] = [];

  for (const test of file.tests) {
    const { data: existing, error: lookupError } = await supabase
      .from("tests")
      .select("id, audio_url")
      .eq("slug", test.slug)
      .maybeSingle();
    if (lookupError) {
      throw new CommitError(
        `Failed to look up slug "${test.slug}": ${lookupError.message}`,
      );
    }

    const audioUrl = await commitAudio(test);

    const payload = {
      slug: test.slug,
      skill: test.skill,
      title: test.title,
      source: file.source,
      duration_minutes: test.duration_minutes,
      content: test.content,
      // Re-committing without R2 configured must not wipe a URL that is already
      // stored; only a successful upload changes it.
      ...(audioUrl !== null ? { audio_url: audioUrl } : {}),
    };

    let testId: string;
    let action: CommitRow["action"];

    if (existing) {
      testId = existing.id as string;
      action = "updated";
      const { error: updateError } = await supabase
        .from("tests")
        .update(payload)
        .eq("id", testId);
      if (updateError) {
        throw new CommitError(
          `Failed to update test "${test.slug}": ${updateError.message}`,
        );
      }
    } else {
      action = "inserted";
      const { data: inserted, error: insertError } = await supabase
        .from("tests")
        .insert(payload)
        .select("id")
        .single();
      if (insertError) {
        throw new CommitError(
          `Failed to insert test "${test.slug}": ${insertError.message}`,
        );
      }
      testId = inserted.id as string;
    }

    const { error: clearError } = await supabase
      .from("questions")
      .delete()
      .eq("test_id", testId);
    if (clearError) {
      throw new CommitError(
        `Failed to clear questions for "${test.slug}": ${clearError.message}`,
      );
    }

    const { error: insertQuestionsError } = await supabase.from("questions").insert(
      test.questions.map((q) => ({
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
      throw new CommitError(
        `Failed to insert questions for "${test.slug}": ${insertQuestionsError.message}`,
      );
    }

    rows.push({
      slug: test.slug,
      action,
      questions: test.questions.length,
      audio:
        audioUrl ??
        (test.audio_file === null
          ? "—"
          : ((existing?.audio_url as string | null) ?? "skipped")),
    });
  }

  console.log(`\n${summaryTable(rows)}\n`);
  console.log(
    `${rows.filter((r) => r.action === "inserted").length} inserted, ` +
      `${rows.filter((r) => r.action === "updated").length} updated. ` +
      `Practise them at /bank.`,
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
