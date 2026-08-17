"use client";

import { useState } from "react";

import type { DueCard, UnitVocabWord } from "@/lib/vocab";
import type { Grade } from "@/lib/srs";
import { reviewCardAction } from "@/app/vocab/actions";

/**
 * The two vocabulary panels: the Warm-up flashcards and the Vocab triage list.
 *
 * Both are presentational plus one server action each, and neither knows about
 * units — so the unit player uses them as session steps and `/vocab` uses the
 * flashcards standalone.
 *
 * The one behavioural rule that matters: a grade is persisted before the next
 * card appears. Warm-up is not a form to be submitted at the end; refreshing
 * halfway through loses nothing that was already answered.
 */

const GRADE_BUTTONS: Array<{ grade: Grade; label: string; hint: string }> = [
  { grade: 0, label: "Again", hint: "No idea — show it again tomorrow" },
  { grade: 1, label: "Hard", hint: "Recalled it, but slowly" },
  { grade: 2, label: "Good", hint: "Recalled it" },
  { grade: 3, label: "Easy", hint: "Instant — push it far out" },
];

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WarmUpPanel({
  cards,
  onFinished,
}: {
  cards: DueCard[];
  /** Called once the last card has been graded. */
  onFinished: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const card = cards[index];

  // Guard rather than crash: `onFinished` moves the player on, and a parent that
  // keeps this mounted anyway gets an empty state instead of a blank screen.
  if (!card) {
    return (
      <section className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
        <p className="eyebrow mb-2.5">Warm-up</p>
        <p className="text-[15px] text-dim">Nothing due right now.</p>
      </section>
    );
  }

  async function grade(value: Grade) {
    if (busy || !card) return;
    setBusy(true);
    setError(null);
    try {
      await reviewCardAction(card.cardId, value);
      setRevealed(false);
      if (index + 1 >= cards.length) {
        onFinished();
      } else {
        setIndex(index + 1);
      }
    } catch (err) {
      // The card stays on screen and stays due; grading again is safe.
      setError(`Could not save that review: ${messageFrom(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <p className="eyebrow">Warm-up</p>
        <p className="font-mono text-[11.5px] text-faint">
          {index + 1} / {cards.length}
        </p>
      </div>

      <div
        className="rounded-[18px] border border-line bg-surface px-7 py-8"
        style={{ boxShadow: "var(--shadow)" }}
      >
        <h1 className="font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.015em]">
          {card.word}
        </h1>

        {revealed ? (
          <>
            {card.ipa && (
              <p className="mt-2 font-mono text-[13.5px] text-dim">{card.ipa}</p>
            )}

            <div className="my-6 h-px bg-line" />

            <dl className="flex flex-col gap-3.5">
              {card.meaningEn && (
                <Detail label="Meaning" value={card.meaningEn} />
              )}
              {card.meaningVi && (
                <Detail label="Tiếng Việt" value={card.meaningVi} />
              )}
              {card.example && <Detail label="Example" value={card.example} italic />}
            </dl>

            <p className="mt-7 mb-3 text-[12.5px] text-faint">
              How well did you recall it?
            </p>
            <div className="flex flex-wrap gap-2">
              {GRADE_BUTTONS.map((button) => (
                <button
                  key={button.grade}
                  type="button"
                  title={button.hint}
                  disabled={busy}
                  onClick={() => void grade(button.grade)}
                  className="rounded-[11px] border px-4 py-2.5 text-[13.5px] font-semibold disabled:opacity-60"
                  style={
                    button.grade === 0
                      ? {
                          borderColor: "color-mix(in oklab, var(--warn) 40%, transparent)",
                          background: "color-mix(in oklab, var(--warn) 10%, transparent)",
                          color: "var(--warn)",
                        }
                      : button.grade === 3
                        ? {
                            borderColor: "transparent",
                            background: "var(--accent)",
                            color: "var(--accent-ink)",
                          }
                        : {
                            borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)",
                            background: "color-mix(in oklab, var(--accent) 10%, transparent)",
                            color: "var(--accent)",
                          }
                  }
                >
                  {button.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mt-5 text-[14px] leading-[1.6] text-dim">
              Say the meaning out loud before you turn the card over.
            </p>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mt-6 rounded-[11px] px-[22px] py-2.5 text-[14px] font-semibold hover:brightness-110"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              Show answer
            </button>
          </>
        )}
      </div>

      {error && (
        <p
          className="mt-4 rounded-xl border px-4 py-3 text-[13.5px]"
          style={{
            borderColor: "color-mix(in oklab, var(--warn) 40%, transparent)",
            background: "color-mix(in oklab, var(--warn) 10%, transparent)",
            color: "var(--warn)",
          }}
        >
          {error}
        </p>
      )}

      <p className="mt-5 text-[12.5px] leading-[1.5] text-faint">
        Each answer is saved as you give it, so you can stop at any point.
      </p>
    </section>
  );
}

function Detail({
  label,
  value,
  italic = false,
}: {
  label: string;
  value: string;
  italic?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <dt className="w-[92px] flex-none text-[12.5px] text-faint">{label}</dt>
      <dd className={`min-w-0 flex-1 text-[15px] leading-[1.55] ${italic ? "italic" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The triage list: every word the unit teaches, each with a checkbox that is
 * **unchecked by default**. Nothing enters the deck because a unit was studied;
 * it enters because the user said this word is worth revisiting.
 *
 * A word already in the deck renders checked and disabled, so re-confirming can
 * never re-add it (and `vocab_cards.word_id` is UNIQUE besides).
 */
export function VocabTriagePanel({
  words,
  checked,
  onToggle,
  readOnly,
  addedCount,
}: {
  words: UnitVocabWord[];
  checked: Set<string>;
  onToggle: (wordId: string, next: boolean) => void;
  /** A completed unit shows the list but cannot change the deck from here. */
  readOnly: boolean;
  /** Set after a successful add, so the step confirms what happened. */
  addedCount: number | null;
}) {
  return (
    <section className="mx-auto max-w-[820px] px-6 pb-10 pt-13">
      <p className="eyebrow mb-2.5">Vocab</p>
      <h1 className="mb-3 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
        Words from this unit
      </h1>
      <p className="mb-7 max-w-[62ch] text-[14.5px] leading-[1.6] text-dim">
        {readOnly
          ? "This unit is already complete, so the list is read-only. Manage the deck from the Vocabulary tab."
          : "Tick the ones you did not already know. Ticked words join your review deck and come back as flashcards at the start of a future session."}
      </p>

      {addedCount !== null && (
        <p
          className="mb-6 rounded-xl border px-4 py-3 text-[13.5px]"
          style={{
            borderColor: "color-mix(in oklab, var(--accent) 35%, transparent)",
            background: "color-mix(in oklab, var(--accent) 10%, transparent)",
            color: "var(--accent)",
          }}
        >
          {addedCount === 0
            ? "Nothing new to add — those words were already in your deck."
            : `Added ${addedCount} word${addedCount === 1 ? "" : "s"} to your review deck.`}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {words.map((word) => {
          const inDeck = word.inDeck;
          const isChecked = inDeck || checked.has(word.wordId);
          return (
            <li
              key={word.wordId}
              className="rounded-2xl border border-line bg-surface px-5 py-4"
            >
              <label className="flex cursor-pointer items-start gap-3.5">
                <input
                  type="checkbox"
                  className="mt-1 h-[17px] w-[17px] flex-none accent-[var(--accent)]"
                  checked={isChecked}
                  disabled={inDeck || readOnly}
                  onChange={(event) => onToggle(word.wordId, event.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-2.5">
                    <span className="font-serif text-[20px] font-medium">
                      {word.word}
                    </span>
                    {word.ipa && (
                      <span className="font-mono text-[12.5px] text-dim">
                        {word.ipa}
                      </span>
                    )}
                    {inDeck && (
                      <span
                        className="rounded-full px-2.5 py-[3px] text-[11px] font-medium"
                        style={{
                          background: "color-mix(in oklab, var(--accent) 12%, transparent)",
                          color: "var(--accent)",
                        }}
                      >
                        In your deck
                      </span>
                    )}
                  </span>

                  {word.meaningEn && (
                    <span className="mt-1.5 block text-[14.5px] leading-[1.5]">
                      {word.meaningEn}
                    </span>
                  )}
                  {word.meaningVi && (
                    <span className="mt-1 block text-[14px] leading-[1.5] text-dim">
                      {word.meaningVi}
                    </span>
                  )}
                  {word.example && (
                    <span className="mt-2 block text-[13.5px] italic leading-[1.5] text-faint">
                      {word.example}
                    </span>
                  )}
                </span>

                {!inDeck && !readOnly && (
                  <span className="mt-1 hidden flex-none text-[12px] text-faint sm:block">
                    Add to my review deck
                  </span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
