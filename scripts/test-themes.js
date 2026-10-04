#!/usr/bin/env node
/**
 * Regression tests for the dashboard THEME SYSTEM expansion:
 * lib/theme.ts + app/globals.css + components/dashboard/theme-switcher.tsx.
 *
 * Owner request (2026-10-04): "add the best popular website themes" — the
 * design languages every modern website imitates (Stripe, Linear, Notion,
 * Vercel, Tailwind, Discord) joined the core set (Dark, Midnight, Dark
 * Emerald, Light). These tests lock:
 *   - the registry shape (ids, swatches, colorSchemes, groups, blurbs)
 *   - the first-paint init script (scheme lookup map — NOT a hardcoded
 *     `t === "light"` check, which would mis-scheme the new light themes)
 *   - the CSS wiring: every theme has a [data-theme] palette block; every
 *     accent-changing theme re-tints the shared glow/focus/button vars;
 *     light-side side-rules key off [data-colorscheme="light"]
 *   - the switcher UI: sectioned Popular/Core grid, wired to the registry
 *
 * Run: node scripts/test-themes.js
 */
"use strict"
const fs = require("fs")
const path = require("path")
const { registerHooks } = require("node:module")

const ROOT = path.join(__dirname, "..")
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8")

let registerOK = true
try {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (e) {
        if (specifier.startsWith(".") && !specifier.endsWith(".ts") && !specifier.endsWith(".js")) {
          return nextResolve(specifier + ".ts", context)
        }
        throw e
      }
    },
  })
} catch {
  registerOK = false
}

let theme
try {
  theme = require("../lib/theme.ts")
} catch (e) {
  console.error("cannot load TS directly:", e.message)
  process.exit(1)
}
if (!registerOK) console.log("note: resolve hook unavailable — direct-path loads used")

let pass = 0, fail = 0
function ok(name, cond) { if (cond) { pass++; console.log("  ✓", name) } else { fail++; console.log("  ✗", name) } }

const css = read("app/globals.css")
const switcher = read("components/dashboard/theme-switcher.tsx")
const shell = read("components/dashboard/shell.tsx")
const accessPage = read("app/access/page.tsx")
const layout = read("app/layout.tsx")

function themeBlock(id) {
  const sel = id === "dark" ? ":root {" : `:root[data-theme="${id}"] {`
  const start = css.indexOf(sel)
  if (start === -1) return ""
  return css.slice(start, css.indexOf("}", start))
}

// ─────────────────── registry: lib/theme.ts ───────────────────
console.log("── THEMES registry: the popular set + core set ──")
const T = theme.THEMES
const EXPECTED = ["dark", "midnight", "emerald", "light", "stripe", "linear", "notion", "vercel", "tailwind", "discord"]
ok("registry loads and has 10 themes", Array.isArray(T) && T.length === 10)
ok("ids are exactly the expected set", EXPECTED.every(id => T.some(t => t.id === id)) && T.every(t => EXPECTED.includes(t.id)))
ok("ids unique", new Set(T.map(t => t.id)).size === T.length)
ok("every theme has a 3-color hex swatch", T.every(t => Array.isArray(t.swatch) && t.swatch.length === 3 && t.swatch.every(c => /^#[0-9a-f]{3,8}$/i.test(c))))
ok("every colorScheme is dark or light", T.every(t => t.colorScheme === "dark" || t.colorScheme === "light"))
ok("every theme has group popular|core", T.every(t => t.group === "popular" || t.group === "core"))
ok("every theme has label + blurb", T.every(t => t.label.trim() && t.blurb.trim()))

const POPULAR = ["stripe", "linear", "notion", "vercel", "tailwind", "discord"]
const CORE = ["dark", "midnight", "emerald", "light"]
ok("popular group = Stripe/Linear/Notion/Vercel/Tailwind/Discord", JSON.stringify(T.filter(t => t.group === "popular").map(t => t.id)) === JSON.stringify(POPULAR))
ok("core group = Dark/Midnight/Emerald/Light", JSON.stringify(T.filter(t => t.group === "core").map(t => t.id)) === JSON.stringify(CORE))
ok("light colorSchemes: light, stripe, notion, tailwind", JSON.stringify(T.filter(t => t.colorScheme === "light").map(t => t.id).sort()) === JSON.stringify(["light", "notion", "stripe", "tailwind"].sort()))
ok("dark colorSchemes: dark, midnight, emerald, linear, vercel, discord", JSON.stringify(T.filter(t => t.colorScheme === "dark").map(t => t.id).sort()) === JSON.stringify(["dark", "midnight", "emerald", "linear", "vercel", "discord"].sort()))

ok("getStoredTheme() defaults to dark without a window (SSR-safe)", theme.getStoredTheme() === "dark")

// ─────────────────── first-paint init script ───────────────────
console.log("── THEME_INIT_SCRIPT: scheme map, not hardcoded light ──")
const script = theme.THEME_INIT_SCRIPT
ok("init script validates against all 10 ids", EXPECTED.every(id => script.includes(JSON.stringify(id))))
ok("init script carries the scheme map (stripe:light)", script.includes('"stripe":"light"'))
ok("scheme map covers notion/tailwind/light as light", script.includes('"notion":"light"') && script.includes('"tailwind":"light"') && script.includes('"light":"light"'))
ok("scheme map keeps dark themes dark", script.includes('"linear":"dark"') && script.includes('"vercel":"dark"') && script.includes('"discord":"dark"') && script.includes('"dark":"dark"'))
ok("init script does NOT hardcode t === \"light\" (would mis-scheme new light themes)", !script.includes('t === "light"'))
ok("init script sets data-colorscheme for light-side CSS", script.includes('setAttribute("data-colorscheme"'))
ok("init script reads the rag-theme storage key", script.includes("rag-theme"))

// ─────────────────── globals.css: palette blocks ───────────────────
console.log("── globals.css: every theme has a working palette block ──")
ok("each non-dark theme has a [data-theme] block", EXPECTED.filter(id => id !== "dark").every(id => css.includes(`:root[data-theme="${id}"] {`)))
// Emerald deliberately re-tints accents on the SAME dark surfaces as the
// default theme, so its block has no --bg-card/--text-primary.
ok("every surface-changing theme defines --bg-card and --text-primary", EXPECTED.filter(id => id !== "emerald").every(id => { const b = themeBlock(id); return b.includes("--bg-card:") && b.includes("--text-primary:") }))
const ACCENT_THEMES = ["stripe", "linear", "notion", "vercel", "tailwind", "discord", "emerald", "light"]
ok("every accent-changing theme re-tints --accent-blue + --gradient-brand", ACCENT_THEMES.every(id => { const b = themeBlock(id); return b.includes("--accent-blue:") && b.includes("--gradient-brand:") }))
ok("midnight intentionally keeps the default accents (bg/text only)", !themeBlock("midnight").includes("--accent-blue:"))
ok("every accent-changing theme re-tints the shared glows (focus ring, button shadow)", ACCENT_THEMES.every(id => { const b = themeBlock(id); return b.includes("--focus-ring:") && b.includes("--shadow-btn:") && b.includes("--shadow-btn-hover:") }))
// Midnight inherits the default dark glow; Light inherits the shared
// light-side glow from the data-colorscheme block.
ok("dark + emerald + all six popular themes declare their page glow tints", ["dark", "emerald", ...POPULAR].every(id => themeBlock(id).includes("--body-glow-1:")))

console.log("── globals.css: signature colors per popular theme ──")
ok("Stripe keeps blurple #635bff", themeBlock("stripe").includes("--accent-blue: #635bff"))
ok("Linear keeps indigo #5e6ad2", themeBlock("linear").includes("--accent-blue: #5e6ad2"))
ok("Notion keeps ink text #37352f", themeBlock("notion").includes("--text-primary: #37352f"))
ok("Vercel keeps #0070f3 / #7928ca", themeBlock("vercel").includes("--accent-blue: #0070f3") && themeBlock("vercel").includes("--accent-violet: #7928ca"))
ok("Tailwind keeps sky-on-slate (#0f172a text, sky gradient)", themeBlock("tailwind").includes("--text-primary: #0f172a") && themeBlock("tailwind").includes("#0ea5e9"))
ok("Discord keeps blurple #5865f2 + fuchsia #eb459e", themeBlock("discord").includes("--accent-blue: #5865f2") && themeBlock("discord").includes("--accent-purple: #eb459e"))

console.log("── globals.css: light-side rules shared via data-colorscheme ──")
ok("light side-rules key off [data-colorscheme=\"light\"]", css.includes(':root[data-colorscheme="light"] {') && css.includes(':root[data-colorscheme="light"] .glass'))
ok("old per-theme light body rule is gone (now var-driven)", !css.includes(':root[data-theme="light"] body'))
ok("body background reads var(--body-glow-1/2)", css.includes("radial-gradient(1100px 550px at 12% -8%, var(--body-glow-1)") && css.includes("var(--body-glow-2)"))
ok("input focus ring reads var(--focus-ring)", css.includes("box-shadow: var(--focus-ring);"))
ok("primary button glow reads var(--shadow-btn)", css.includes("box-shadow: var(--shadow-btn);"))
ok("scrollbar reads var(--scrollbar-thumb)", css.includes("background: var(--scrollbar-thumb);"))

// ─────────────────── switcher UI wiring ───────────────────
console.log("── theme-switcher.tsx: sectioned picker wired to the registry ──")
ok("imports THEMES + helpers from lib/theme", switcher.includes("from \"@/lib/theme\"") && switcher.includes("THEMES"))
ok("renders Popular and Core sections", switcher.includes("Popular") && switcher.includes("Core"))
ok("options come from the registry, not a local list", switcher.includes("THEMES.filter(t => t.group === g.id)"))
ok("each option calls setTheme through pick(t.id)", switcher.includes("onClick={() => pick(t.id)}"))
ok("active option highlighted + check-marked", switcher.includes("aria-pressed={isActive}") && switcher.includes("<Check"))
ok("dropdown scrolls instead of pushing offscreen", switcher.includes("overflowY: \"auto\""))

console.log("── mount points unchanged ──")
ok("dashboard shell mounts the switcher", shell.includes("ThemeSwitcher"))
ok("access page mounts the switcher", accessPage.includes("ThemeSwitcher"))
ok("layout inlines the pre-paint init script", layout.includes("THEME_INIT_SCRIPT"))

// ─────────────────── report ───────────────────
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
