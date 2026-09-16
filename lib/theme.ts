// Dashboard theme system. Every dashboard component already styles itself
// through CSS custom properties (var(--bg-card), var(--text-primary), etc.)
// rather than hardcoded colors, so switching themes is just swapping which
// value set those variables resolve to — see the [data-theme="..."] blocks
// in app/globals.css. No component needs to know themes exist.

export type ThemeId = "dark" | "midnight" | "emerald" | "light"

export const THEMES: { id: ThemeId; label: string; swatch: [string, string, string]; colorScheme: "dark" | "light" }[] = [
  { id: "dark",     label: "Dark",          swatch: ["#0e1320", "#8b7cff", "#5b7cfa"], colorScheme: "dark" },
  { id: "midnight", label: "Midnight",      swatch: ["#000000", "#8b7cff", "#5b7cfa"], colorScheme: "dark" },
  { id: "emerald",  label: "Dark Emerald",  swatch: ["#0e1320", "#10b981", "#14b8a6"], colorScheme: "dark" },
  { id: "light",    label: "Light",         swatch: ["#ffffff", "#4a6cf0", "#7c6ae8"], colorScheme: "light" },
]

const STORAGE_KEY = "rag-theme"
const DEFAULT_THEME: ThemeId = "dark"

export function getStoredTheme(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME
  const saved = window.localStorage.getItem(STORAGE_KEY)
  return (THEMES.some(t => t.id === saved) ? saved : DEFAULT_THEME) as ThemeId
}

export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement
  // "dark" is the CSS default (:root with no attribute) rather than its own
  // [data-theme="dark"] block — removing the attribute entirely for it keeps
  // globals.css from needing to duplicate the default block under a name.
  if (theme === "dark") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", theme)
  root.style.colorScheme = THEMES.find(t => t.id === theme)?.colorScheme || "dark"
}

export function setTheme(theme: ThemeId): void {
  try { window.localStorage.setItem(STORAGE_KEY, theme) } catch {}
  applyTheme(theme)
}

// Inlined into <head> (see app/layout.tsx) so the right theme is applied
// before first paint — without this, every page load would flash the dark
// theme for a frame even for someone who picked Light.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("${STORAGE_KEY}");
    var valid = ${JSON.stringify(THEMES.map(t => t.id))};
    if (t && valid.indexOf(t) === -1) t = null;
    if (t && t !== "dark") document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = (t === "light") ? "light" : "dark";
  } catch (e) {}
})();
`
