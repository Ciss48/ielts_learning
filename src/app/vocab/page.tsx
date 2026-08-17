import { getRoadmap } from "@/lib/roadmap";
import { countDueCards, getDeck, getDueCards, DEFAULT_DUE_LIMIT } from "@/lib/vocab";
import { formatDayLabel } from "@/lib/day";
import { AppHeader } from "@/components/AppHeader";
import { VocabReview } from "@/components/vocab/VocabReview";

/**
 * The vocabulary library: the whole deck, what is due, and a way to review it
 * outside a session.
 *
 * Words get into the deck one way only — the Vocab step of a unit, where the
 * user ticks what they did not already know. There is no adding, editing or
 * deleting here: `vocab_words` is seeded content, and this page is a view of the
 * user's schedule over it.
 */
export default async function VocabPage() {
  const [deck, dueCount, dueCards, roadmap] = await Promise.all([
    getDeck(),
    countDueCards(),
    getDueCards(),
    getRoadmap(),
  ]);
  const currentSeq = roadmap.find((u) => u.status === "current")?.seq ?? null;

  return (
    <div className="min-h-screen">
      <AppHeader active="vocab" sessionSeq={currentSeq} />

      <main className="mx-auto max-w-[1180px] px-6 pb-20 pt-11">
        <p className="eyebrow mb-2.5">Vocabulary</p>
        <h1 className="mb-3 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
          Your review deck
        </h1>
        <p className="mb-8 max-w-[62ch] text-[14.5px] leading-[1.6] text-dim">
          Words you ticked during a session. Each one comes back on a spacing
          schedule that stretches every time you recall it and resets when you do
          not. Reviewing here is the same as the warm-up at the start of a
          session — it does not touch the roadmap or your study log.
        </p>

        <div className="mb-9 flex flex-wrap items-end gap-8 rounded-2xl border border-line bg-surface px-6 py-5 shadow-card">
          <Stat label="Cards" value={String(deck.length)} />
          <Stat
            label="Due today"
            value={String(dueCount)}
            accent={dueCount > 0}
          />
          <div className="ml-auto">
            <VocabReview cards={dueCards} />
            {dueCount > DEFAULT_DUE_LIMIT && (
              <p className="mt-2 text-right text-[12px] text-faint">
                {DEFAULT_DUE_LIMIT} at a time — the rest stay due.
              </p>
            )}
          </div>
        </div>

        {deck.length === 0 ? (
          <div className="rounded-2xl border border-line bg-surface px-6 py-8 text-[14px] leading-[1.6] text-dim shadow-card">
            <p className="mb-2 font-semibold text-text">Your deck is empty.</p>
            <p className="max-w-[64ch]">
              Finish a unit that teaches vocabulary and tick the words you did
              not already know on its Vocab step. They will appear here, and as
              flashcards at the start of a later session.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line">
                  <Th>Word</Th>
                  <Th>Meaning</Th>
                  <Th align="right">Due</Th>
                  <Th align="right">Interval</Th>
                  <Th align="right">Reps</Th>
                  <Th align="right">Lapses</Th>
                </tr>
              </thead>
              <tbody>
                {deck.map((card) => (
                  <tr
                    key={card.cardId}
                    className="border-b border-line last:border-b-0"
                  >
                    <td className="px-4 py-3.5">
                      <span className="font-serif text-[16px] font-medium">
                        {card.word}
                      </span>
                      {card.ipa && (
                        <p className="mt-0.5 font-mono text-[11.5px] text-faint">
                          {card.ipa}
                        </p>
                      )}
                    </td>
                    <td className="max-w-[42ch] px-4 py-3.5">
                      {card.meaningEn && (
                        <p className="text-[13.5px] leading-[1.5]">
                          {card.meaningEn}
                        </p>
                      )}
                      {card.meaningVi && (
                        <p className="mt-0.5 text-[13px] leading-[1.5] text-dim">
                          {card.meaningVi}
                        </p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono text-[12.5px] tabular-nums">
                      <span
                        style={card.isDue ? { color: "var(--accent)" } : undefined}
                        title={formatDayLabel(card.dueDate)}
                      >
                        {card.isDue ? "due now" : card.dueDate}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-[12.5px] tabular-nums text-dim">
                      {card.intervalDays === 0 ? "new" : `${card.intervalDays}d`}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-[12.5px] tabular-nums text-dim">
                      {card.reps}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-[12.5px] tabular-nums">
                      {card.lapses === 0 ? (
                        <span className="text-faint">0</span>
                      ) : (
                        <span style={{ color: "var(--warn)" }}>{card.lapses}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow mb-1.5">{label}</p>
      <p
        className="font-mono text-[30px] leading-none tabular-nums"
        style={accent ? { color: "var(--accent)" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-[11px] font-medium uppercase tracking-[0.06em] text-faint ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
