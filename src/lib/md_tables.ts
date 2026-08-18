/**
 * Splitting a markdown string into prose blocks and GFM pipe tables — pure.
 *
 * Why this exists: the architect's ruling for Phase 05 is that a Task 1 prompt
 * describes its data as a markdown table rather than as a chart image, so a
 * table is not decoration here — it is the question. `react-markdown` renders
 * CommonMark, and pipe tables are a GitHub extension it only understands with
 * `remark-gfm`, which would be a new dependency (a Definition-of-Done item says
 * there is none). So the table is lifted out and rendered as a real `<table>`,
 * and everything around it goes to `react-markdown` unchanged.
 *
 * The subset recognised is the one a table is actually written in: a header
 * row of pipe-delimited cells, a delimiter row of dashes (with optional
 * alignment colons), then body rows until the first line that is not a pipe
 * row. Escaped pipes (`\|`) inside a cell are not supported — no seed content
 * uses one, and inventing a half-working escape rule would be worse than not
 * having it.
 */

export interface MarkdownProse {
  kind: "markdown";
  text: string;
}

export interface MarkdownTable {
  kind: "table";
  header: string[];
  rows: string[][];
}

export type MarkdownBlock = MarkdownProse | MarkdownTable;

/** A line made of pipe-delimited cells, e.g. `| 2005 | 10% |`. */
function isPipeRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1;
}

/** The `|---|:--:|` line that turns the row above it into a header. */
function isDelimiterRow(line: string): boolean {
  if (!isPipeRow(line)) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

export function splitMarkdownTables(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n");
  const blocks: MarkdownBlock[] = [];
  let prose: string[] = [];

  function flushProse(): void {
    if (prose.join("\n").trim() !== "") {
      blocks.push({ kind: "markdown", text: prose.join("\n") });
    }
    prose = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const isTableStart =
      isPipeRow(lines[i]) &&
      i + 1 < lines.length &&
      isDelimiterRow(lines[i + 1]);

    if (!isTableStart) {
      prose.push(lines[i]);
      continue;
    }

    flushProse();

    const header = splitRow(lines[i]);
    const rows: string[][] = [];
    let cursor = i + 2;
    while (cursor < lines.length && isPipeRow(lines[cursor])) {
      rows.push(splitRow(lines[cursor]));
      cursor += 1;
    }
    blocks.push({ kind: "table", header, rows });
    i = cursor - 1;
  }

  flushProse();
  return blocks;
}
