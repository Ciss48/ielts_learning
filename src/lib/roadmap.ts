/**
 * Roadmap engine — server-only.
 *
 * The roadmap is strictly sequential. The pointer rule (see CLAUDE.md) is:
 *   current unit = the lowest `units.seq` that has no `unit_completions` row.
 * Nothing else defines progress: no dates, no streaks, no "days since start".
 * Skipping days never skips units.
 */

import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/day";

export type Block =
  | "diagnostic"
  | "foundation"
  | "skill_cycle"
  | "mock"
  | "taper";

export type Skill =
  | "reading"
  | "listening"
  | "writing"
  | "speaking"
  | "vocab"
  | "mixed";

export interface Unit {
  id: string;
  seq: number;
  block: Block;
  skill: Skill;
  title: string;
  strategyMd: string;
  testId: string | null;
  estMinutes: number;
  elsaTask: string | null;
}

export type UnitStatus = "done" | "current" | "locked";

/** Shape of a `units` row as it comes back from PostgREST. */
interface UnitRow {
  id: string;
  seq: number;
  block: Block;
  skill: Skill;
  title: string;
  strategy_md: string;
  test_id: string | null;
  est_minutes: number;
  elsa_task: string | null;
}

const UNIT_COLUMNS =
  "id, seq, block, skill, title, strategy_md, test_id, est_minutes, elsa_task";

function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    seq: row.seq,
    block: row.block,
    skill: row.skill,
    title: row.title,
    strategyMd: row.strategy_md,
    testId: row.test_id,
    estMinutes: row.est_minutes,
    elsaTask: row.elsa_task,
  };
}

/** Every unit ordered by seq, plus the set of unit ids already completed. */
async function loadProgress(): Promise<{
  units: UnitRow[];
  completed: Set<string>;
}> {
  const supabase = await createClient();

  const [unitsResult, completionsResult] = await Promise.all([
    supabase.from("units").select(UNIT_COLUMNS).order("seq", { ascending: true }),
    supabase.from("unit_completions").select("unit_id"),
  ]);

  if (unitsResult.error) {
    throw new Error(`Failed to load units: ${unitsResult.error.message}`);
  }
  if (completionsResult.error) {
    throw new Error(
      `Failed to load unit completions: ${completionsResult.error.message}`,
    );
  }

  return {
    units: (unitsResult.data ?? []) as UnitRow[],
    completed: new Set(
      (completionsResult.data ?? []).map((row) => row.unit_id as string),
    ),
  };
}

function firstUncompleted(
  units: UnitRow[],
  completed: Set<string>,
): UnitRow | null {
  return units.find((u) => !completed.has(u.id)) ?? null;
}

/** Lowest seq with no unit_completions row; null when the roadmap is finished. */
export async function getCurrentUnit(): Promise<Unit | null> {
  const { units, completed } = await loadProgress();
  const row = firstUncompleted(units, completed);
  return row ? toUnit(row) : null;
}

/** Fetch one unit by seq; null if it doesn't exist. */
export async function getUnitBySeq(seq: number): Promise<Unit | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("units")
    .select(UNIT_COLUMNS)
    .eq("seq", seq)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load unit seq ${seq}: ${error.message}`);
  }
  return data ? toUnit(data as UnitRow) : null;
}

/**
 * Insert into unit_completions (idempotent — completing twice is a no-op) and
 * upsert study_log for today (Asia/Ho_Chi_Minh date): minutes += unit.estMinutes,
 * units_completed += 1 (only on first completion).
 * Returns the next uncompleted seq, or null if roadmap finished.
 */
export async function completeUnit(
  unitId: string,
): Promise<{ nextSeq: number | null }> {
  const supabase = await createClient();

  const { data: unitRow, error: unitError } = await supabase
    .from("units")
    .select(UNIT_COLUMNS)
    .eq("id", unitId)
    .maybeSingle();

  if (unitError) {
    throw new Error(`Failed to load unit ${unitId}: ${unitError.message}`);
  }
  if (!unitRow) {
    throw new Error(`No unit with id ${unitId}`);
  }
  const unit = toUnit(unitRow as UnitRow);

  // ON CONFLICT DO NOTHING: a replayed request returns zero rows, which is the
  // signal that this was NOT the first completion and study_log must not move.
  const { data: inserted, error: completionError } = await supabase
    .from("unit_completions")
    .upsert({ unit_id: unitId }, { onConflict: "unit_id", ignoreDuplicates: true })
    .select("unit_id");

  if (completionError) {
    throw new Error(
      `Failed to record completion for unit ${unitId}: ${completionError.message}`,
    );
  }

  const isFirstCompletion = (inserted ?? []).length > 0;

  if (isFirstCompletion) {
    const day = today();

    const { data: logRow, error: logReadError } = await supabase
      .from("study_log")
      .select("day, minutes, units_completed")
      .eq("day", day)
      .maybeSingle();

    if (logReadError) {
      throw new Error(`Failed to read study_log: ${logReadError.message}`);
    }

    const { error: logWriteError } = await supabase.from("study_log").upsert(
      {
        day,
        minutes: (logRow?.minutes ?? 0) + unit.estMinutes,
        units_completed: (logRow?.units_completed ?? 0) + 1,
      },
      { onConflict: "day" },
    );

    if (logWriteError) {
      throw new Error(`Failed to write study_log: ${logWriteError.message}`);
    }
  }

  const next = await getCurrentUnit();
  return { nextSeq: next?.seq ?? null };
}

/** All units ordered by seq with status. Exactly one unit is 'current'. */
export async function getRoadmap(): Promise<
  Array<Unit & { status: UnitStatus }>
> {
  const { units, completed } = await loadProgress();
  const currentId = firstUncompleted(units, completed)?.id ?? null;

  return units.map((row) => ({
    ...toUnit(row),
    status: completed.has(row.id)
      ? ("done" as const)
      : row.id === currentId
        ? ("current" as const)
        : ("locked" as const),
  }));
}
