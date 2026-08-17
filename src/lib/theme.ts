/**
 * Theme persistence shared by the root layout (server) and the toggle (client),
 * so neither has to import across the "use client" boundary.
 */

export const THEME_STORAGE_KEY = "ielts-daily-theme";

/**
 * Blocking script applied before first paint, so the page never flashes the
 * wrong palette. Falls back to the OS preference when nothing is stored.
 */
export const themeInitScript = `
try {
  var t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
  if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
} catch (e) {}
`;
