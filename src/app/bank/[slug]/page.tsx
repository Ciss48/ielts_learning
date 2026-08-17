import { notFound } from "next/navigation";

import { getRoadmap } from "@/lib/roadmap";
import { getTestBySlug, getUnsupportedQTypes } from "@/lib/tests";
import { AppHeader } from "@/components/AppHeader";
import { BankSession } from "@/components/session/BankSession";

/**
 * Practise one bank test. Auth-protected by the middleware like every other
 * route. Nothing on this page can move the roadmap: the unit player and its
 * `completeUnitAction` are not involved at all.
 */
export default async function BankTestPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const test = await getTestBySlug(slug);
  if (!test) notFound();

  const [unsupportedQTypes, roadmap] = await Promise.all([
    getUnsupportedQTypes(test.id),
    getRoadmap(),
  ]);
  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader active="bank" sessionSeq={currentSeq} />
      <BankSession
        test={test}
        slug={slug}
        unsupportedQTypes={unsupportedQTypes}
      />
    </div>
  );
}
