import { notFound, redirect } from "next/navigation";

import { getRoadmap } from "@/lib/roadmap";
import { getTestForUnit, getUnsupportedQTypes, type PlayerTest } from "@/lib/tests";
import { getDueCards, getUnitVocab } from "@/lib/vocab";
import { AppHeader } from "@/components/AppHeader";
import { UnitSession } from "@/components/session/UnitSession";

/**
 * Grading an essay is one model call that has been measured at 18-94 seconds,
 * and a malformed reply costs a second one — so the worst realistic case is
 * around three minutes. A server action runs in the function that serves its own
 * route segment, which is this page, so the limit has to be raised HERE rather
 * than on the `"use server"` file. Vercel's default would abort the request
 * mid-grade and the user would see a failure for work the provider actually did.
 *
 * 300s is the Fluid-compute maximum on the Hobby plan; the app never uses
 * anything like it, because `ai.ts` gives up first (3 attempts x 180s timeout is
 * its own ceiling and it backs off long before this one).
 */
export const maxDuration = 300;

export default async function UnitPage({
  params,
}: {
  params: Promise<{ seq: string }>;
}) {
  const { seq: seqParam } = await params;
  const seq = Number(seqParam);
  if (!Number.isInteger(seq) || seq < 1) notFound();

  // One query pair gives the unit, its status and the pointer, so the guard
  // reads the same truth the roadmap does.
  const roadmap = await getRoadmap();
  const unit = roadmap.find((u) => u.seq === seq);
  if (!unit) notFound();

  // Guard: anything past the pointer is locked and must not be reachable.
  if (unit.status === "locked") redirect("/");

  const isCompleted = unit.status === "done";
  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  // A completed unit is read-only, so it skips Practice entirely — there is
  // nothing left to attempt and `completeUnit` has already run.
  const needsTest = unit.testId !== null && !isCompleted;

  const [test, unsupportedQTypes, warmUpCards, vocab] = await Promise.all([
    needsTest ? getTestForUnit(unit.testId as string) : Promise.resolve(null),
    needsTest ? getUnsupportedQTypes(unit.testId as string) : Promise.resolve([]),
    // Warm-up is capped at 20 cards a session; zero due cards means the step
    // simply does not appear.
    getDueCards(),
    getUnitVocab(unit.id),
  ]);

  return (
    <div className="min-h-screen">
      <AppHeader active="session" sessionSeq={currentSeq} />
      <UnitSession
        unit={unit}
        isCompleted={isCompleted}
        // A dangling test_id would otherwise strand the unit with no way to
        // finish; falling back to null gives the Strategy → Complete player.
        test={test as PlayerTest | null}
        unsupportedQTypes={unsupportedQTypes}
        warmUpCards={warmUpCards}
        vocab={vocab}
      />
    </div>
  );
}
