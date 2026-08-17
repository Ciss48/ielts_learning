"use client";

import { useEffect, useState } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  // The real value only exists on the client; sync after hydration.
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled — the theme still applies for this page.
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Toggle theme"
      aria-label="Toggle theme"
      className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full border border-line bg-surface text-[13px] text-dim hover:text-text"
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
