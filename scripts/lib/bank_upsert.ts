/**
 * The one way a bank test enters the database.
 *
 * Phase 03 gave `ingest_commit.ts` the id-stable slug upsert: a `tests` row is
 * NEVER deleted, because `attempts` reference it, so a slug that already exists
 * is updated in place and keeps its primary key — and with it the user's
 * history. Questions carry no history of their own and are replaced wholesale.
 *
 * Phase 05 added a second writer: `seed.ts` now accepts a top-level `tests[]`
 * for bank tests authored by hand (the writing tasks) rather than extracted
 * from a PDF. Both writers need exactly that discipline, so it lives here and
 * neither of them owns a copy of it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SeedQuestion, TestSkill } from "./validate";

export class BankUpsertError extends Error {}

export interface BankTest {
  slug: string;
  skill: TestSkill;
  title: string;
  /** Provenance, shown nowhere yet but stored: a PDF name or a seed file path. */
  source: string | null;
  durationMinutes: number;
  content: Record<string, unknown>;
  /**
   * A freshly uploaded audio URL, or null to leave whatever is already stored
   * alone — re-committing without R2 configured must not wipe a stored URL.
   */
  audioUrl: string | null;
  questions: SeedQuestion[];
}

export interface BankUpsertResult {
  testId: string;
  action: "inserted" | "updated";
  /** What `audio_url` held before this call, for the caller's summary line. */
  previousAudioUrl: string | null;
  questions: number;
}

export async function upsertBankTest(
  supabase: SupabaseClient,
  test: BankTest,
): Promise<BankUpsertResult> {
  const { data: existing, error: lookupError } = await supabase
    .from("tests")
    .select("id, audio_url")
    .eq("slug", test.slug)
    .maybeSingle();
  if (lookupError) {
    throw new BankUpsertError(
      `Failed to look up slug "${test.slug}": ${lookupError.message}`,
    );
  }

  const payload = {
    slug: test.slug,
    skill: test.skill,
    title: test.title,
    source: test.source,
    duration_minutes: test.durationMinutes,
    content: test.content,
    ...(test.audioUrl !== null ? { audio_url: test.audioUrl } : {}),
  };

  let testId: string;
  let action: BankUpsertResult["action"];

  if (existing) {
    testId = existing.id as string;
    action = "updated";
    const { error: updateError } = await supabase
      .from("tests")
      .update(payload)
      .eq("id", testId);
    if (updateError) {
      throw new BankUpsertError(
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
      throw new BankUpsertError(
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
    throw new BankUpsertError(
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
    throw new BankUpsertError(
      `Failed to insert questions for "${test.slug}": ${insertQuestionsError.message}`,
    );
  }

  return {
    testId,
    action,
    previousAudioUrl: (existing?.audio_url as string | null) ?? null,
    questions: test.questions.length,
  };
}
