import Link from "next/link";

import { signOutAction } from "@/lib/auth-actions";
import { formatToday } from "@/lib/labels";
import { ThemeToggle } from "@/components/ThemeToggle";

type Tab = "today" | "session" | "roadmap" | "vocab" | "bank";

const TAB_BASE =
  "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors";

function tabStyle(active: boolean) {
  return active
    ? { background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow)" }
    : { background: "transparent", color: "var(--dim)" };
}

/**
 * Sticky app chrome: wordmark + date, the tab pill nav, theme and sign-out.
 * `sessionSeq` is the current unit the Session tab points at — null when the
 * roadmap is finished or nothing is seeded yet.
 */
export function AppHeader({
  active,
  sessionSeq,
}: {
  active: Tab;
  sessionSeq: number | null;
}) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-line px-6 py-3.5 backdrop-blur-[10px]"
      style={{ background: "color-mix(in oklab, var(--bg) 88%, transparent)" }}
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="font-serif text-[19px] font-semibold tracking-[-0.01em]">
          IELTS Daily
        </span>
        <span className="hidden font-mono text-[11px] uppercase tracking-[0.06em] text-faint sm:inline">
          {formatToday()}
        </span>
      </div>

      <nav className="flex gap-0.5 rounded-full border border-line bg-surface-2 p-[3px]">
        <Link href="/" className={TAB_BASE} style={tabStyle(active === "today")}>
          Today
        </Link>
        {sessionSeq === null ? (
          <span
            className={`${TAB_BASE} cursor-default opacity-50`}
            style={tabStyle(false)}
          >
            Session
          </span>
        ) : (
          <Link
            href={`/unit/${sessionSeq}`}
            className={TAB_BASE}
            style={tabStyle(active === "session")}
          >
            Session
          </Link>
        )}
        <Link
          href="/roadmap"
          className={TAB_BASE}
          style={tabStyle(active === "roadmap")}
        >
          Roadmap
        </Link>
        <Link
          href="/vocab"
          className={TAB_BASE}
          style={tabStyle(active === "vocab")}
          title="Your spaced-repetition word deck"
        >
          Vocabulary
        </Link>
        <Link
          href="/bank"
          className={TAB_BASE}
          style={tabStyle(active === "bank")}
          title="Extra practice outside the roadmap"
        >
          Practice
        </Link>
      </nav>

      <div className="flex flex-none items-center gap-2">
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-full border border-line bg-surface px-3 py-[7px] text-[12.5px] text-dim hover:text-text"
          >
            Sign out
          </button>
        </form>
        <ThemeToggle />
      </div>
    </header>
  );
}
