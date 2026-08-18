"use client";

import ReactMarkdown from "react-markdown";

import type { PlayerEssay, PlayerTest } from "@/lib/tests";
import type { WritingFeedback } from "@/lib/writing";
import { MIN_ESSAY_WORDS, countWords } from "@/lib/words";
import { splitMarkdownTables } from "@/lib/md_tables";

/**
 * The writing panels: intro, the timed writing surface, and the feedback
 * review. They are the essay counterparts of `PracticePanels.tsx`'s three, and
 * like those they know nothing about units — they take a `PlayerTest` whose
 * `essay` is non-null, and the feedback, and that is all. Both players use them.
 *
 * `countWords` is imported from `@/lib/words` rather than `@/lib/writing`
 * because the latter is server-only (it reaches the AI client); the counting
 * rule itself has exactly one implementation, and this is it.
 */

const TASK_LABEL: Record<PlayerEssay["taskType"], string> = {
  task1: "Task 1",
  task2: "Task 2",
};

const CRITERION_LABEL: Record<
  WritingFeedback["criteria"][number]["name"],
  { task1: string; task2: string }
> = {
  TR: { task1: "Task Achievement", task2: "Task Response" },
  CC: { task1: "Coherence and Cohesion", task2: "Coherence and Cohesion" },
  LR: { task1: "Lexical Resource", task2: "Lexical Resource" },
  GRA: {
    task1: "Grammatical Range and Accuracy",
    task2: "Grammatical Range and Accuracy",
  },
};

/**
 * Markdown with GFM pipe tables rendered as real tables.
 *
 * A Task 1 prompt's data IS a table (the architect's ruling: described data,
 * never a chart image), and `react-markdown` only understands pipe tables with
 * `remark-gfm` — a dependency this phase does not add. So the tables are lifted
 * out by `splitMarkdownTables` and everything else goes to `react-markdown`
 * untouched.
 */
export function MarkdownWithTables({ markdown }: { markdown: string }) {
  const blocks = splitMarkdownTables(markdown);

  return (
    <>
      {blocks.map((block, i) =>
        block.kind === "markdown" ? (
          <ReactMarkdown key={i}>{block.text}</ReactMarkdown>
        ) : (
          <div key={i} className="my-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line">
                  {block.header.map((cell, j) => (
                    <th
                      key={j}
                      scope="col"
                      className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint"
                    >
                      {cell}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, j) => (
                  <tr key={j} className="border-b border-line last:border-b-0">
                    {row.map((cell, k) => (
                      <td key={k} className="px-3 py-2 font-mono tabular-nums">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </>
  );
}

export function EssayIntro({
  test,
  essay,
  busy,
}: {
  test: PlayerTest;
  essay: PlayerEssay;
  busy: boolean;
}) {
  return (
    <section className="mx-auto max-w-[68ch] px-6 pb-10 pt-13">
      <p className="eyebrow mb-2.5">Practice</p>
      <h1 className="mb-4 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
        {test.title}
      </h1>

      <dl className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Fact label="Task" value={TASK_LABEL[essay.taskType]} />
        <Fact label="Minimum" value={`${essay.minWords} words`} />
        <Fact label="Time limit" value={`${test.durationMinutes} min`} />
      </dl>

      <ul className="mb-2 flex flex-col gap-2 text-[14px] text-dim">
        <li>The clock starts as soon as you press Begin.</li>
        <li>At 00:00 your essay is submitted for feedback automatically.</li>
        <li>
          Feedback comes from a model reading your text against the band
          descriptors — one grade per attempt, and no rewriting afterwards.
        </li>
        <li>
          Anything under {MIN_ESSAY_WORDS} words is not sent for feedback at all.
        </li>
        <li>Refreshing the page restarts the attempt.</li>
      </ul>

      {busy && <p className="mt-6 text-[13px] text-faint">Starting…</p>}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <dt className="eyebrow mb-1">{label}</dt>
      <dd className="font-mono text-[15px]">{value}</dd>
    </div>
  );
}

export function EssayPanel({
  essay,
  text,
  disabled,
  onChange,
}: {
  essay: PlayerEssay;
  text: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const words = countWords(text);

  return (
    <div className="mx-auto grid max-w-[1180px] items-start gap-8 px-6 pb-10 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <section className="min-w-0 rounded-2xl border border-line bg-surface px-6 py-7 shadow-card sm:px-8 lg:sticky lg:top-[82px] lg:max-h-[calc(100vh-118px)] lg:overflow-y-auto">
        <p className="eyebrow mb-2">
          {TASK_LABEL[essay.taskType]} · at least {essay.minWords} words
        </p>
        <div className="prose-passage">
          <MarkdownWithTables markdown={essay.promptMd} />
        </div>
        <div className="my-5 h-px bg-line" />
        <p className="text-[12.5px] leading-[1.5] text-faint">{essay.prompt}</p>
      </section>

      <section className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <label htmlFor="essay" className="text-[13px] font-semibold">
            Your response
          </label>
          <WordCount words={words} minWords={essay.minWords} />
        </div>

        <textarea
          id="essay"
          value={text}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          spellCheck={false}
          placeholder="Write your response here. Plain text — formatting is not marked."
          className="min-h-[52vh] w-full resize-y rounded-xl border border-line bg-surface-2 px-4 py-3.5 text-[14.5px] leading-[1.65] outline-none focus:border-[color-mix(in_oklab,var(--accent)_55%,transparent)] disabled:opacity-60"
        />

        <div className="my-4 h-px bg-line" />
        <p className="text-[12.5px] leading-[1.5] text-faint">
          No feedback until you submit. Spell-check is off on purpose — spelling
          is part of Lexical Resource.
        </p>
      </section>
    </div>
  );
}

/** Live count; it turns accent-coloured the moment the minimum is reached. */
function WordCount({ words, minWords }: { words: number; minWords: number }) {
  const reached = words >= minWords;
  return (
    <p
      className="font-mono text-[12.5px] tabular-nums"
      style={{ color: reached ? "var(--accent)" : "var(--faint)" }}
      aria-live="polite"
    >
      {words} / {minWords} words
    </p>
  );
}

/** The under-50-words state: nothing was sent, nothing was saved. */
export function EssayRefusal({ words }: { words: number }) {
  return (
    <p
      className="mt-4 rounded-xl border px-4 py-3 text-[13.5px] leading-[1.5]"
      style={{
        borderColor: "color-mix(in oklab, var(--warn) 40%, transparent)",
        background: "color-mix(in oklab, var(--warn) 10%, transparent)",
        color: "var(--warn)",
      }}
    >
      {words} word{words === 1 ? "" : "s"} is not enough to grade. Nothing under{" "}
      {MIN_ESSAY_WORDS} words is sent for feedback, so no attempt was submitted
      and nothing was saved — keep writing, or start again.
    </p>
  );
}

export function EssayFeedbackPanel({
  test,
  essay,
  feedback,
  text,
}: {
  test: PlayerTest;
  essay: PlayerEssay;
  feedback: WritingFeedback;
  text: string;
}) {
  const words = countWords(text);

  return (
    <section className="mx-auto max-w-[820px] px-6 pb-10 pt-13">
      <p className="eyebrow mb-2.5">Review</p>
      <h1 className="mb-6 font-serif text-[32px] font-medium leading-[1.2] tracking-[-0.015em]">
        {test.title}
      </h1>

      <div className="mb-9 flex flex-wrap items-end gap-8 rounded-2xl border border-line bg-surface px-6 py-5 shadow-card">
        <div>
          <p className="eyebrow mb-1.5">Overall band</p>
          <p
            className="font-mono text-[30px] leading-none tabular-nums"
            style={{ color: "var(--accent)" }}
          >
            {feedback.overallBand.toFixed(1)}
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-faint">
            AI estimate ±0.5
          </p>
        </div>
        <div>
          <p className="eyebrow mb-1.5">Length</p>
          <p className="font-mono text-[30px] leading-none tabular-nums">
            {words}
          </p>
          <p className="mt-1.5 font-mono text-[11.5px] text-faint">
            of {essay.minWords} required
          </p>
        </div>
        <p className="max-w-[34ch] text-[12.5px] leading-[1.5] text-faint">
          The mean of the four criteria below, rounded to the nearest half band.
          A model is not an examiner — treat it as a direction, not a result.
        </p>
      </div>

      {feedback.lengthNote !== null && (
        <p
          className="mb-8 rounded-xl border px-4 py-3 text-[13.5px] leading-[1.5]"
          style={{
            borderColor: "color-mix(in oklab, var(--warn) 40%, transparent)",
            background: "color-mix(in oklab, var(--warn) 10%, transparent)",
            color: "var(--warn)",
          }}
        >
          {feedback.lengthNote}
        </p>
      )}

      <ol className="mb-9 flex flex-col gap-4">
        {feedback.criteria.map((criterion) => (
          <li
            key={criterion.name}
            className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-card"
          >
            <div className="mb-2 flex items-baseline gap-3">
              <span className="font-mono text-[12px] text-faint">
                {criterion.name}
              </span>
              <span className="text-[13px] font-semibold">
                {CRITERION_LABEL[criterion.name][essay.taskType]}
              </span>
              <span
                className="ml-auto font-mono text-[18px] tabular-nums"
                style={{ color: "var(--accent)" }}
              >
                {criterion.band.toFixed(1)}
              </span>
            </div>
            <p className="text-[14px] leading-[1.6] text-dim">
              {criterion.comment}
            </p>

            {criterion.capped && (
              <p className="mt-2 text-[12.5px] leading-[1.5]" style={{ color: "var(--warn)" }}>
                Capped at {criterion.band.toFixed(1)} — {criterion.errors.length}{" "}
                spelling or word-form errors were found in your text.
              </p>
            )}

            {/* The evidence under the band. Every quote here is a literal
                substring of what was submitted — anything the model could not
                point at in the essay was dropped before this rendered. */}
            {criterion.errors.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="eyebrow mb-2">
                  Found in your text ({criterion.errors.length})
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {criterion.errors.map((error, i) => (
                    <li
                      key={i}
                      className="rounded-md px-2 py-1 font-mono text-[12px] leading-[1.4]"
                      style={{
                        background: "color-mix(in oklab, var(--warn) 10%, transparent)",
                        color: "var(--warn)",
                      }}
                    >
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ol>

      <h2 className="mb-3 font-serif text-[22px] font-medium">Top fixes</h2>
      <ol className="mb-9 flex list-decimal flex-col gap-2 pl-5 text-[14px] leading-[1.6]">
        {feedback.topFixes.map((fix, i) => (
          <li key={i}>{fix}</li>
        ))}
      </ol>

      {feedback.improvedSentences.length > 0 && (
        <>
          <h2 className="mb-3 font-serif text-[22px] font-medium">
            Sentences to rewrite
          </h2>
          <ul className="flex flex-col gap-4">
            {feedback.improvedSentences.map((sentence, i) => (
              <li
                key={i}
                className="rounded-2xl border border-line bg-surface px-5 py-4"
              >
                <p className="mb-2 text-[13.5px] leading-[1.6] text-dim">
                  <span className="eyebrow mr-2">You wrote</span>
                  {sentence.original}
                </p>
                <p
                  className="mb-2 text-[14px] leading-[1.6]"
                  style={{ color: "var(--accent)" }}
                >
                  <span className="eyebrow mr-2" style={{ color: "inherit" }}>
                    Better
                  </span>
                  {sentence.improved}
                </p>
                <p className="text-[12.5px] leading-[1.5] text-faint">
                  {sentence.reason}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
