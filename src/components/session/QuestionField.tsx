"use client";

import type { PlayerQuestion } from "@/lib/tests";

/**
 * One question's input.
 *
 * Choice questions submit the option string EXACTLY as it appears in `options`.
 * The letter labels ("A)", "B)"…) are a visual aid for long option lists only —
 * they are never part of the submitted value, because the seed's answer keys
 * are written against the option text.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Short, self-describing options (TRUE / FALSE / NOT GIVEN) read better bare. */
const LETTERED_QTYPES: ReadonlySet<string> = new Set(["mcq", "matching"]);

export function QuestionField({
  question,
  value,
  onChange,
  disabled = false,
}: {
  question: PlayerQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { qnum, qtype, prompt, options } = question;
  const answered = value.trim() !== "";

  return (
    <fieldset className="min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 flex w-full items-baseline gap-2.5">
        <span
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full font-mono text-[11px]"
          style={{
            background: answered
              ? "color-mix(in oklab, var(--accent) 15%, transparent)"
              : "var(--surface-2)",
            color: answered ? "var(--accent)" : "var(--faint)",
          }}
        >
          {qnum}
        </span>
        <span className="min-w-0 flex-1 text-[13.5px] leading-[1.5]">{prompt}</span>
      </legend>

      {options ? (
        <div className="flex flex-col gap-1.5 pl-[32px]">
          {options.map((option, i) => {
            const selected = value === option;
            return (
              <label
                key={option}
                className="flex cursor-pointer items-start gap-2.5 rounded-[9px] border px-2.5 py-2 text-[13px] leading-[1.45]"
                style={{
                  borderColor: selected
                    ? "color-mix(in oklab, var(--accent) 45%, transparent)"
                    : "var(--line)",
                  background: selected
                    ? "color-mix(in oklab, var(--accent) 9%, transparent)"
                    : "var(--surface-2)",
                  color: selected ? "var(--accent)" : "var(--text)",
                }}
              >
                <input
                  type="radio"
                  name={`q-${qnum}`}
                  className="sr-only"
                  checked={selected}
                  onChange={() => onChange(option)}
                />
                <span
                  aria-hidden
                  className="mt-[3px] h-[13px] w-[13px] flex-none rounded-full border-2"
                  style={{
                    borderColor: selected ? "var(--accent)" : "var(--faint)",
                    background: selected ? "var(--accent)" : "transparent",
                    boxShadow: selected ? "inset 0 0 0 2px var(--surface)" : "none",
                  }}
                />
                {LETTERED_QTYPES.has(qtype) && (
                  <span className="flex-none font-mono text-[12px] text-faint">
                    {LETTERS[i] ?? i + 1})
                  </span>
                )}
                <span className="min-w-0 flex-1">{option}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="pl-[32px]">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Your answer"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-[9px] border border-line bg-surface-2 px-3 py-2 font-mono text-[13.5px] text-text outline-none focus:border-accent"
          />
        </div>
      )}
    </fieldset>
  );
}
