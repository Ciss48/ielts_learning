import { notFound } from "next/navigation";

import { getTestAttempts } from "@/lib/dashboard";
import { getRoadmap } from "@/lib/roadmap";
import { getTestBySlug, getUnsupportedQTypes } from "@/lib/tests";
import { AppHeader } from "@/components/AppHeader";
import { BankSession } from "@/components/session/BankSession";

/**
 * Practise one bank test. Auth-protected by the middleware like every other
 * route. Nothing on this page can move the roadmap: the unit player and its
 * `completeUnitAction` are not involved at all.
 */
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

export default async function BankTestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const test = await getTestBySlug(slug);
  if (!test) notFound();

  const [unsupportedQTypes, roadmap, attempts] = await Promise.all([
    getUnsupportedQTypes(test.id),
    getRoadmap(),
    getTestAttempts(test.id),
  ]);
  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader active="bank" sessionSeq={currentSeq} />
      <BankSession
        test={test}
        slug={slug}
        unsupportedQTypes={unsupportedQTypes}
        attempts={attempts}
      />
    </div>
  );
}
