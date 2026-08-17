"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type { DueCard } from "@/lib/vocab";
import { WarmUpPanel } from "@/components/session/VocabPanels";

/**
 * "Review now" on `/vocab` — the same flashcards as the session warm-up, run
 * standalone.
 *
 * It is the same `WarmUpPanel`, the same server action and the same 20-card cap,
 * so a card graded here and a card graded in a session are indistinguishable
 * afterwards. The only difference is what surrounds it: no session steps, and
 * nothing here touches the roadmap.
 */
export function VocabReview({ cards }: { cards: DueCard[] }) {
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const router = useRouter();

  if (finished) {
    return (
      <div className="rounded-2xl border border-line bg-surface px-6 py-5">
        <p className="text-[15px]">
          Done — {cards.length} card{cards.length === 1 ? "" : "s"} reviewed.
        </p>
        <button
          type="button"
          onClick={() => {
            // The deck table below is server-rendered, so it needs a refresh to
            // show the new due dates.
            setFinished(false);
            setRunning(false);
            router.refresh();
          }}
          className="mt-4 rounded-[11px] border border-line px-5 py-2.5 text-[14px] font-semibold text-dim hover:text-text"
        >
          Back to the deck
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <WarmUpPanel
        cards={cards}
        onFinished={() => {
          setFinished(true);
          router.refresh();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setRunning(true)}
      disabled={cards.length === 0}
      className="rounded-[11px] px-[22px] py-2.5 text-[14px] font-semibold hover:brightness-110 disabled:opacity-50"
      style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
    >
      {cards.length === 0
        ? "Nothing due today"
        : `Review now · ${cards.length} card${cards.length === 1 ? "" : "s"}`}
    </button>
  );
}
