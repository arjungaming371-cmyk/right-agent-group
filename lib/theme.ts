// Dashboard theme system. Every dashboard component already styles itself
// through CSS custom properties (var(--bg-card), var(--text-primary), etc.)
// rather than hardcoded colors, so switching themes is just swapping which
// value set those variables resolve to — see the [data-theme="..."] blocks
// in app/globals.css. No component needs to know themes exist.
//
// Two groups:
//   "popular" — the design languages every modern website imitates (Stripe,
//               Linear, Notion, Vercel, Tailwind, Discord), added by owner
//               request ("add the best popular website themes").
//   "core"    — the original in-house set.

export type ThemeId =
  | "dark" | "midnight" | "emerald" | "light"
  | "stripe" | "linear" | "notion" | "vercel" | "tailwind" | "discord"

export type ThemeGroup = "popular" | "core"

export const THEMES: {
  id: ThemeId
  label: string
  swatch: [string, string, string]
  colorScheme: "dark" | "light"
  group: ThemeGroup
  blurb: string
}[] = [
  // ---- Popular picks (the most-copied looks in web design) ----
  { id: "stripe",   label: "Stripe",   swatch: ["#ffffff", "#635bff", "#0a2540"], colorScheme: "light", group: "popular", blurb: "SaaS light · blurple" },
  { id: "linear",   label: "Linear",   swatch: ["#191a1d", "#5e6ad2", "#828fff"], colorScheme: "dark",  group: "popular", blurb: "Dark · indigo glow" },
  { id: "notion",   label: "Notion",   swatch: ["#ffffff", "#2383e2", "#37352f"], colorScheme: "light", group: "popular", blurb: "Paper minimal" },
  { id: "vercel",   label: "Vercel",   swatch: ["#000000", "#0070f3", "#7928ca"], colorScheme: "dark",  group: "popular", blurb: "Mono black" },
  { id: "tailwind", label: "Tailwind", swatch: ["#ffffff", "#0ea5e9", "#8b5cf6"], colorScheme: "light", group: "popular", blurb: "Sky on white" },
  { id: "discord",  label: "Discord",  swatch: ["#313338", "#5865f2", "#eb459e"], colorScheme: "dark",  group: "popular", blurb: "Chat dark · blurple" },
  // ---- Core set (original in-house looks) ----
  { id: "dark",     label: "Dark",          swatch: ["#0e1320", "#8b7cff", "#5b7cfa"], colorScheme: "dark",  group: "core", blurb: "Default violet" },
  { id: "midnight", label: "Midnight",      swatch: ["#000000", "#8b7cff", "#5b7cfa"], colorScheme: "dark",  group: "core", blurb: "OLED black" },
  { id: "emerald",  label: "Dark Emerald",  swatch: ["#0e1320", "#10b981", "#14b8a6"], colorScheme: "dark",  group: "core", blurb: "Dark teal" },
  { id: "light",    label: "Light",         swatch: ["#ffffff", "#4a6cf0", "#7c6ae8"], colorScheme: "light", group: "core", blurb: "Clean light" },
]

const STORAGE_KEY = "rag-theme"
const DEFAULT_THEME: ThemeId = "dark"

const SCHEME_BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t.colorScheme])) as Record<ThemeId, "dark" | "light">

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
  const scheme = SCHEME_BY_ID[theme] || "dark"
  root.style.colorScheme = scheme
  // Light-side CSS (body glow tints, glass, scrollbar) keys off this attribute,
  // so a new light theme only declares its palette — it never repeats the
  // side-condition rules. This is what lets Stripe/Notion/Tailwind be light
  // without copying the Light theme's extra blocks in globals.css.
  root.setAttribute("data-colorscheme", scheme)
}

export function setTheme(theme: ThemeId): void {
  try { window.localStorage.setItem(STORAGE_KEY, theme) } catch {}
  applyTheme(theme)
}

// Inlined into <head> (see app/layout.tsx) so the right theme is applied
// before first paint — without this, every page load would flash the dark
// theme for a frame even for someone who picked Light.
//
// The scheme lookup is a map, NOT a `t === "light"` check: with six new
// popular themes there are three more light colorSchemes (stripe, notion,
// tailwind) and a hardcoded id comparison would silently run them with
// color-scheme: dark (wrong native form controls, scrollbars, inputs).
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("${STORAGE_KEY}");
    var valid = ${JSON.stringify(THEMES.map(t => t.id))};
    if (t && valid.indexOf(t) === -1) t = null;
    var schemes = ${JSON.stringify(SCHEME_BY_ID)};
    var scheme = (t && schemes[t]) || "dark";
    if (t && t !== "dark") document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.setAttribute("data-colorscheme", scheme);
  } catch (e) {}
})();
`
