"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { completeUnit, getCurrentUnit, getUnitBySeq } from "@/lib/roadmap";

/**
 * Mark the unit complete and send the user back to Today, which now shows the
 * next unit. Guarded server-side: a replayed or forged request for a unit that
 * is not the current pointer is refused rather than skipping the roadmap ahead.
 */
export async function completeUnitAction(formData: FormData): Promise<void> {
  const seq = Number(formData.get("seq"));
  if (!Number.isInteger(seq)) {
    throw new Error("completeUnitAction called without a valid seq");
  }

  const [unit, current] = await Promise.all([getUnitBySeq(seq), getCurrentUnit()]);

  if (!unit) {
    throw new Error(`No unit with seq ${seq}`);
  }
  // Only the current unit can be completed. Already-completed units and locked
  // units both land here; both are a no-op that just returns to Today.
  if (current && current.seq === seq) {
    await completeUnit(unit.id);
  }

  revalidatePath("/", "layout");
  redirect("/");
}
