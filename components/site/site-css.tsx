// Shared scoped design system for the PUBLIC marketing site (the ".rg-*"
// system that app/page.tsx pioneered). One module so every public page —
// homepage, /demo, /pricing, legal pages, /help — renders the exact same
// dark-premium language without coupling to globals.css or the console
// theme-switcher. Rendered once per page via <SiteStyle/> inside SiteShell.
//
// Technique (unchanged from the original LANDING_CSS approach): a single
// inline <style> with scoped class prefixes, zero CSS-in-JS runtime, zero
// client JS for static sections.

export const SITE_CSS = `
/* ---------- base ---------- */
.rg-root { min-height: 100vh; background: #05070c; color: #eef1f7; font-family: var(--font-inter), Inter, system-ui, sans-serif; overflow-x: hidden; }
.rg-root * { box-sizing: border-box; }
.rg-shell { position: relative; z-index: 1; min-height: 100vh; display: flex; flex-direction: column; }
.rg-main { flex: 1 0 auto; }
.rg-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(1100px 640px at 0% -5%, rgba(139,124,255,0.14), transparent 55%),
    radial-gradient(900px 560px at 100% 15%, rgba(56,189,248,0.08), transparent 55%),
    radial-gradient(800px 600px at 50% 110%, rgba(139,124,255,0.10), transparent 60%),
    #05070c; }
.rg-grid { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0.35;
  background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(ellipse 90% 70% at 50% 0%, black, transparent); }
.rg-skip { position: absolute; left: -9999px; top: 0; z-index: 100; background: #8b7cff; color: #fff;
  padding: 10px 16px; border-radius: 0 0 10px 0; font-size: 13px; font-weight: 600; text-decoration: none; }
.rg-skip:focus, .rg-skip:focus-visible { left: 0; }

/* ---------- nav ---------- */
.rg-navwrap { position: sticky; top: 0; z-index: 50; border-bottom: 1px solid rgba(255,255,255,0.05);
  background: rgba(5,7,12,0.72); backdrop-filter: blur(16px) saturate(150%); -webkit-backdrop-filter: blur(16px) saturate(150%); }
.rg-nav { display: flex; align-items: center; justify-content: space-between; gap: 18px;
  max-width: 1240px; margin: 0 auto; padding: 12px clamp(18px, 4vw, 40px); }
.rg-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.rg-brand-mark { width: 34px; height: 34px; border-radius: 10px; flex-shrink: 0;
  background: linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%);
  color: #fff; font-weight: 800; font-size: 16px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 18px -6px rgba(91,124,250,0.7); }
.rg-brand-name { color: #fff; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; white-space: nowrap; }
.rg-nav-links { display: flex; align-items: center; gap: 22px; }
.rg-nav-links a { color: #9aa5bd; text-decoration: none; font-size: 13.5px; font-weight: 500; transition: color .15s; white-space: nowrap; }
.rg-nav-links a:hover { color: #fff; }
.rg-nav-actions { display: flex; align-items: center; gap: 10px; }
.rg-burger { display: none; width: 40px; height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.10);
  background: rgba(255,255,255,0.03); color: #eef1f7; align-items: center; justify-content: center; }
.rg-mobile { border-top: 1px solid rgba(255,255,255,0.05); background: rgba(5,7,12,0.97);
  padding: 12px clamp(18px, 4vw, 40px) 20px; display: flex; flex-direction: column; gap: 2px; }
.rg-mobile a.rg-mobile-link { color: #c6cede; text-decoration: none; font-size: 14.5px; font-weight: 500; padding: 11px 8px; border-radius: 8px; }
.rg-mobile a.rg-mobile-link:hover { background: rgba(255,255,255,0.04); color: #fff; }
.rg-mobile-actions { display: flex; gap: 10px; padding-top: 12px; }
.rg-mobile-actions .rg-btn { flex: 1; }

/* ---------- buttons ---------- */
.rg-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border-radius: 11px;
  font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; transition: all .18s; white-space: nowrap; border: none; }
.rg-btn-primary { background: linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%); color: #fff;
  padding: 12px 22px; box-shadow: 0 8px 28px -8px rgba(91,124,250,0.55); }
.rg-btn-primary:hover { filter: brightness(1.12); transform: translateY(-1px); box-shadow: 0 12px 34px -8px rgba(91,124,250,0.7); }
.rg-btn-primary:disabled { opacity: 0.5; filter: none; transform: none; cursor: not-allowed; }
.rg-btn-ghost { border: 1px solid rgba(255,255,255,0.10); color: #eef1f7; padding: 12px 22px; background: rgba(255,255,255,0.03); }
.rg-btn-ghost:hover { border-color: rgba(165,176,255,0.45); background: rgba(139,124,255,0.08); }
.rg-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.rg-btn-sm { padding: 9px 16px; font-size: 13px; border-radius: 10px; }
.rg-btn-lg { padding: 14px 28px; font-size: 15px; border-radius: 12px; }

/* ---------- section primitives ---------- */
.rg-section { max-width: 1140px; margin: 0 auto; padding: clamp(56px, 8vw, 100px) clamp(18px, 4vw, 40px); }
.rg-eyebrow { display: inline-flex; align-items: center; gap: 8px; border-radius: 999px;
  border: 1px solid rgba(139,124,255,0.25); background: rgba(139,124,255,0.10);
  color: #a5b0ff; font-size: 12px; font-weight: 500; padding: 7px 14px; letter-spacing: 0.02em; }
.rg-h2 { font-size: clamp(26px, 3.6vw, 40px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; color: #fff; margin: 18px 0 12px; }
.rg-h3 { font-size: clamp(19px, 2.4vw, 24px); font-weight: 700; letter-spacing: -0.015em; line-height: 1.25; color: #fff; margin: 14px 0 10px; }
.rg-lead { color: #9aa5bd; font-size: 15.5px; line-height: 1.7; max-width: 640px; }
.rg-center { text-align: center; }
.rg-center .rg-lead { margin-left: auto; margin-right: auto; }
.rg-grad { background: linear-gradient(135deg, #a5b0ff, #5b7cfa 50%, #38bdf8);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.rg-glass { background: rgba(14,19,32,0.66); border: 1px solid #1c2437; border-radius: 18px;
  backdrop-filter: blur(14px) saturate(140%); box-shadow: 0 24px 60px -30px rgba(0,0,0,0.8); }

/* ---------- subpage hero ---------- */
.rgpage { max-width: 1140px; margin: 0 auto; padding: clamp(48px, 7vw, 84px) clamp(18px, 4vw, 40px) 0; text-align: center; }
.rgpage h1 { font-size: clamp(30px, 4.6vw, 50px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; color: #fff; margin: 18px 0 0; }
.rgpage .rg-lead { margin: 18px auto 0; }

/* ---------- hero (homepage) ---------- */
.rg-hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: clamp(32px, 5vw, 72px); align-items: center;
  max-width: 1140px; margin: 0 auto; padding: clamp(56px, 8vw, 96px) clamp(18px, 4vw, 40px) clamp(48px, 6vw, 72px); }
.rg-hero h1 { font-size: clamp(34px, 5.2vw, 58px); font-weight: 800; letter-spacing: -0.03em; line-height: 1.08; color: #fff; margin: 22px 0 0; }
.rg-hero p.rg-sub { margin: 20px 0 0; color: #9aa5bd; font-size: clamp(14.5px, 1.4vw, 16.5px); line-height: 1.75; max-width: 540px; }
.rg-hero-cta { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 32px; }
.rg-trust { display: flex; align-items: center; gap: 8px; margin-top: 26px; color: #727e9c; font-size: 12.5px; line-height: 1.5; }
.rg-trust svg { flex-shrink: 0; color: #2dd4a0; }

/* ---------- console vignette (static, aria-hidden) ---------- */
.rg-vignette { position: relative; border-radius: 20px; padding: 14px; }
.rg-float { animation: rg-float 7s ease-in-out infinite; }
@keyframes rg-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
.rg-vbar { display: flex; align-items: center; gap: 6px; padding: 2px 6px 12px; }
.rg-dot { width: 9px; height: 9px; border-radius: 50%; background: rgba(255,255,255,0.14); }
.rg-vbody { background: rgba(5,7,12,0.8); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.rg-vrow { display: flex; align-items: center; gap: 10px; }
.rg-bubble { border-radius: 13px; padding: 10px 13px; font-size: 12.5px; line-height: 1.5; max-width: 80%; }
.rg-in { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); color: #c6cede; border-bottom-left-radius: 4px; }
.rg-out { background: linear-gradient(135deg, rgba(139,124,255,0.28), rgba(56,189,248,0.22)); border: 1px solid rgba(139,124,255,0.28); color: #e4e7ff; border-bottom-right-radius: 4px; margin-left: auto; }
.rg-callcard { display: flex; align-items: center; gap: 12px; background: rgba(45,212,160,0.06); border: 1px solid rgba(45,212,160,0.18); border-radius: 12px; padding: 12px 14px; }
.rg-pulse { width: 9px; height: 9px; border-radius: 50%; background: #2dd4a0; box-shadow: 0 0 0 0 rgba(45,212,160,0.5); animation: rg-pulse 1.8s infinite; flex-shrink: 0; }
@keyframes rg-pulse { 0% { box-shadow: 0 0 0 0 rgba(45,212,160,0.45); } 70% { box-shadow: 0 0 0 9px rgba(45,212,160,0); } 100% { box-shadow: 0 0 0 0 rgba(45,212,160,0); } }

/* ---------- cards / steps / bento ---------- */
.rg-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 44px; }
.rg-card { padding: 26px 24px; transition: transform .2s, border-color .2s; }
.rg-card:hover { transform: translateY(-4px); border-color: rgba(139,124,255,0.35); }
.rg-card-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(139,124,255,0.25); background: rgba(139,124,255,0.10); color: #a5b0ff; margin-bottom: 18px; }
.rg-card h3 { font-size: 16px; font-weight: 700; color: #fff; margin: 0 0 8px; letter-spacing: -0.01em; }
.rg-card p { font-size: 13.5px; color: #8b96ad; line-height: 1.65; margin: 0; }
.rg-card ul { list-style: none; padding: 0; margin: 14px 0 0; display: flex; flex-direction: column; gap: 7px; }
.rg-card li { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; color: #9aa5bd; line-height: 1.5; }
.rg-card li svg { flex-shrink: 0; margin-top: 2px; color: #2dd4a0; }
.rg-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 48px; }
.rg-step { position: relative; padding: 26px 24px; }
.rg-step-num { position: absolute; top: -14px; left: 22px; width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg, #8b7cff, #38bdf8); color: #fff; font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 6px 18px -6px rgba(91,124,250,0.6); }
.rg-step h3 { font-size: 14.5px; font-weight: 700; color: #fff; margin: 12px 0 7px; }
.rg-step p { font-size: 12.5px; color: #8b96ad; line-height: 1.6; margin: 0; }
.rg-bento { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 44px; }
.rg-bento .rg-wide { grid-column: span 2; }
.rg-minicard { padding: 18px; }
.rg-minicard h3 { font-size: 13.5px; }
.rg-minicard p { font-size: 12.5px; }

/* ---------- problem pipelines ---------- */
.rg-flows { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 44px; }
.rg-flow { padding: 26px 24px; }
.rg-flow-head { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 18px; }
.rg-flow-head svg { flex-shrink: 0; }
.rg-flowsteps { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.rg-flowstep { font-size: 12px; padding: 7px 11px; border-radius: 8px; background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07); color: #9aa5bd; line-height: 1.35; }
.rg-flow-arrow { color: #4a5570; flex-shrink: 0; display: inline-flex; }
.rg-flow-bad .rg-flowstep { border-color: rgba(251,86,112,0.16); }
.rg-flow-bad .rg-flow-arrow { color: rgba(251,86,112,0.55); }
.rg-flow-good { border-color: rgba(45,212,160,0.22); }
.rg-flow-good .rg-flowstep { border-color: rgba(45,212,160,0.20); background: rgba(45,212,160,0.05); color: #c4d4cd; }
.rg-flow-good .rg-flow-arrow { color: rgba(45,212,160,0.7); }
.rg-flowline { margin-top: 34px; text-align: center; color: #c6cede; font-size: 15.5px; font-weight: 600; letter-spacing: -0.01em; }

/* ---------- FAQ ---------- */
.rg-faq { max-width: 780px; margin: 44px auto 0; display: flex; flex-direction: column; gap: 12px; }
.rg-faq details { background: rgba(14,19,32,0.66); border: 1px solid #1c2437; border-radius: 14px; overflow: hidden; }
.rg-faq summary { list-style: none; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 18px 22px; font-size: 14.5px; font-weight: 600; color: #eef1f7; }
.rg-faq summary::-webkit-details-marker { display: none; }
.rg-faq summary svg { color: #64708c; flex-shrink: 0; transition: transform .2s; }
.rg-faq details[open] summary svg { transform: rotate(180deg); }
.rg-faq .rg-answer { padding: 0 22px 18px; font-size: 13.5px; color: #8b96ad; line-height: 1.7; }

/* ---------- final CTA ---------- */
.rg-cta { text-align: center; padding: clamp(56px, 8vw, 96px) clamp(18px, 4vw, 40px); }
.rg-cta .rg-glass { max-width: 860px; margin: 0 auto; padding: clamp(36px, 5vw, 60px) clamp(24px, 5vw, 56px);
  background: linear-gradient(160deg, rgba(139,124,255,0.14), rgba(14,19,32,0.85) 45%), rgba(14,19,32,0.66); }
.rg-cta-actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 14px; margin-top: 28px; }

/* ---------- footer ---------- */
.rg-footer { border-top: 1px solid rgba(255,255,255,0.05); margin-top: auto; padding: 46px clamp(18px, 4vw, 40px) 30px; }
.rg-footer-inner { max-width: 1140px; margin: 0 auto; }
.rg-footer-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 32px; flex-wrap: wrap; }
.rg-footer-brand-name { color: #fff; font-weight: 700; font-size: 15px; }
.rg-footer-tag { color: #64708c; font-size: 12.5px; }
.rg-footer-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.rg-footer-col h3 { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.09em; color: #727e9c; margin: 0 0 14px; }
.rg-footer-col ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.rg-footer-col a { color: #9aa5bd; text-decoration: none; font-size: 13px; transition: color .15s; }
.rg-footer-col a:hover { color: #c7c9ff; }
.rg-footer-bottom { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px 24px;
  border-top: 1px solid rgba(255,255,255,0.05); margin-top: 34px; padding-top: 22px; color: #6c7690; font-size: 12px; line-height: 1.6; }

/* ---------- demo chat island (Test Priya) ---------- */
.dmc-wrap { max-width: 720px; margin: 40px auto 0; }
.dmc-head { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.dmc-title { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 700; color: #fff; }
.dmc-title .dmc-avatar { width: 30px; height: 30px; font-size: 13px; }
.dmc-lang { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #9aa5bd; }
.dmc-lang select { width: auto; padding: 7px 10px; border-radius: 9px; font-size: 13px; }
.dmc-consent { display: flex; gap: 10px; align-items: flex-start; background: rgba(139,124,255,0.06);
  border: 1px solid rgba(139,124,255,0.22); border-radius: 12px; padding: 13px 15px; font-size: 12.5px;
  color: #b9c0d4; margin-bottom: 14px; cursor: pointer; line-height: 1.55; }
.dmc-consent input { width: 16px; height: 16px; margin-top: 2px; accent-color: #6d5cff; flex-shrink: 0; cursor: pointer; }
.dmc-card { overflow: hidden; }
.dmc-log { height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 18px; }
.dmc-log::-webkit-scrollbar { width: 6px; }
.dmc-log::-webkit-scrollbar-track { background: transparent; }
.dmc-log::-webkit-scrollbar-thumb { background: #232c42; border-radius: 999px; }
.dmc-msg { display: flex; gap: 10px; align-items: flex-end; max-width: 88%; }
.dmc-msg.dmc-user { margin-left: auto; flex-direction: row-reverse; }
.dmc-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%);
  color: #fff; font-size: 12px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.dmc-bubble { border-radius: 13px; padding: 10px 13px; font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.dmc-ai .dmc-bubble { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); color: #dbe0ec; border-bottom-left-radius: 5px; }
.dmc-user .dmc-bubble { background: linear-gradient(135deg, rgba(139,124,255,0.30), rgba(56,189,248,0.22));
  border: 1px solid rgba(139,124,255,0.30); color: #eef0ff; border-bottom-right-radius: 5px; }
.dmc-typing { display: inline-flex; gap: 4px; align-items: center; padding: 13px 14px; }
.dmc-typing i { width: 6px; height: 6px; border-radius: 50%; background: #8b96ad; animation: dmc-blink 1.2s infinite; }
.dmc-typing i:nth-child(2) { animation-delay: 0.15s; }
.dmc-typing i:nth-child(3) { animation-delay: 0.3s; }
@keyframes dmc-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.dmc-empty { color: #6c7690; font-size: 12.5px; text-align: center; margin: auto; max-width: 400px; line-height: 1.7; padding: 20px 0; }
.dmc-inputrow { display: flex; gap: 10px; padding: 14px; border-top: 1px solid rgba(255,255,255,0.05); }
.dmc-input { flex: 1; }
.dmc-send { width: 44px; height: 44px; border-radius: 11px; border: none; flex-shrink: 0;
  background: linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%); color: #fff;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px -8px rgba(91,124,250,0.6); }
.dmc-send:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
.dmc-send:not(:disabled):hover { filter: brightness(1.12); }
.dmc-alert { background: rgba(251,86,112,0.08); border: 1px solid rgba(251,86,112,0.25); color: #ffb3c0;
  border-radius: 10px; padding: 10px 14px; font-size: 12.5px; margin: 0 14px 12px; display: flex; gap: 8px;
  align-items: center; justify-content: space-between; flex-wrap: wrap; line-height: 1.5; }
.dmc-alert a { color: #c7c9ff; font-weight: 600; text-decoration: none; white-space: nowrap; }
.dmc-alert a:hover { text-decoration: underline; }
.dmc-disclosure { display: flex; gap: 7px; align-items: flex-start; font-size: 11.5px; color: #6c7690; margin-top: 12px; line-height: 1.6; }
.dmc-disclosure svg { flex-shrink: 0; margin-top: 1px; }

/* ---------- demo booking form ---------- */
.rgf-card { padding: clamp(22px, 3vw, 32px); }
.rgf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.rgf-field { display: flex; flex-direction: column; gap: 7px; }
.rgf-full { grid-column: 1 / -1; }
.rgf-label { font-size: 12.5px; font-weight: 600; color: #b9c0d4; }
.rgf-req { color: #fb5670; }
.rgf-input, .rgf-select, .rgf-text { width: 100%; background: rgba(5,7,12,0.7); border: 1px solid #1c2437; color: #eef1f7;
  border-radius: 10px; padding: 11px 13px; font-size: 13.5px; font-family: inherit; outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease; }
.rgf-input:hover, .rgf-select:hover, .rgf-text:hover { border-color: #273148; }
.rgf-input:focus, .rgf-select:focus, .rgf-text:focus { border-color: #5b7cfa; box-shadow: 0 0 0 3px rgba(91,124,250,0.16); }
.rgf-input::placeholder, .rgf-text::placeholder { color: #64708c; }
.rgf-select { appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, #9aa5bd 50%), linear-gradient(135deg, #9aa5bd 50%, transparent 50%);
  background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%; background-size: 5px 5px; background-repeat: no-repeat; padding-right: 34px; }
.rgf-hp { position: absolute; left: -6000px; top: -6000px; height: 1px; width: 1px; overflow: hidden; }
.rgf-actions { margin-top: 22px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.rgf-error { color: #ffb3c0; font-size: 12.5px; line-height: 1.5; }
.rgf-hint { color: #64708c; font-size: 11.5px; margin-top: 14px; line-height: 1.6; }
.rgf-success { text-align: center; padding: clamp(30px, 5vw, 48px) 24px; }
.rgf-success-icon { width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 18px; display: flex; align-items: center; justify-content: center;
  background: rgba(45,212,160,0.10); border: 1px solid rgba(45,212,160,0.30); color: #2dd4a0; }
.rgf-success h3 { font-size: 19px; color: #fff; font-weight: 700; margin: 0 0 10px; }
.rgf-success p { font-size: 13.5px; color: #9aa5bd; line-height: 1.7; max-width: 420px; margin: 0 auto 22px; }

/* ---------- demo page layout ---------- */
.rg-demo-grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 24px; align-items: start; }
.rg-side-card { padding: 24px; position: sticky; top: 88px; }
.rg-side-card h2 { font-size: 14px; font-weight: 700; color: #fff; margin: 0 0 16px; }
.rg-side-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
.rg-side-list li { display: flex; gap: 12px; align-items: flex-start; font-size: 13px; color: #9aa5bd; line-height: 1.55; }
.rg-side-list svg { flex-shrink: 0; color: #a5b0ff; margin-top: 1px; }
.rg-side-note { margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 12px; color: #6c7690; line-height: 1.6; }

/* ---------- pricing ---------- */
.rgp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 48px; align-items: stretch; }
.rgp-tier { padding: 30px 28px; display: flex; flex-direction: column; position: relative; }
.rgp-tier.rgp-highlight { border-color: rgba(139,124,255,0.45); box-shadow: 0 24px 60px -30px rgba(91,124,250,0.55); }
.rgp-badge { position: absolute; top: -13px; left: 50%; transform: translateX(-50%);
  background: linear-gradient(135deg, #8b7cff, #38bdf8); color: #fff; font-size: 10.5px; font-weight: 700;
  padding: 4px 14px; border-radius: 999px; letter-spacing: 0.06em; white-space: nowrap; }
.rgp-name { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 6px; }
.rgp-price { display: flex; align-items: baseline; gap: 5px; margin-bottom: 8px; }
.rgp-price b { font-size: 32px; font-weight: 800; color: #fff; letter-spacing: -0.02em; }
.rgp-price span { font-size: 13px; color: #64708c; }
.rgp-tag { font-size: 12.5px; color: #9aa5bd; margin-bottom: 22px; }
.rgp-features { list-style: none; padding: 0; margin: 0 0 26px; display: flex; flex-direction: column; gap: 11px; flex: 1; }
.rgp-features li { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; color: #9aa5bd; line-height: 1.5; }
.rgp-features svg { color: #2dd4a0; flex-shrink: 0; margin-top: 1px; }
.rgp-factors { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-top: 22px; }
.rgp-factor { display: flex; gap: 9px; align-items: center; font-size: 13px; color: #9aa5bd; padding: 12px 15px;
  background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; }
.rgp-factor svg { color: #a5b0ff; flex-shrink: 0; }
.rgp-note { margin-top: 18px; font-size: 12.5px; color: #6c7690; line-height: 1.7; max-width: 760px; }
.rgp-note b { color: #9aa5bd; font-weight: 600; }

/* ---------- legal prose ---------- */
.rg-legal { max-width: 780px; margin: 0 auto; }
.rg-legal h2 { font-size: 18px; color: #fff; margin: 36px 0 10px; font-weight: 700; letter-spacing: -0.01em; }
.rg-legal p, .rg-legal li { font-size: 14px; color: #9aa5bd; line-height: 1.75; }
.rg-legal ul { padding-left: 22px; margin: 10px 0; display: flex; flex-direction: column; gap: 6px; }
.rg-legal strong { color: #c6cede; font-weight: 600; }
.rg-legal a { color: #a5b0ff; text-decoration: none; }
.rg-legal a:hover { text-decoration: underline; }
.rg-ph { color: #c7c9ff; background: rgba(139,124,255,0.08); border: 1px dashed rgba(139,124,255,0.30); border-radius: 6px; padding: 1px 7px; font-size: 13px; }
.rg-updated { font-size: 12px; color: #6c7690; margin-top: 6px; }
.rg-legal-notice { background: rgba(139,124,255,0.05); border: 1px solid rgba(139,124,255,0.18); border-radius: 12px; padding: 15px 18px; font-size: 13px !important; color: #b9c0d4 !important; margin: 22px 0; line-height: 1.7; }

/* ---------- security page ---------- */
.rgsec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 44px; }
.rgsec-card { padding: 22px; }
.rgsec-card h3 { font-size: 14.5px; font-weight: 700; color: #fff; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; }
.rgsec-card h3 svg { color: #a5b0ff; flex-shrink: 0; }
.rgsec-card p { font-size: 12.5px; color: #8b96ad; line-height: 1.65; margin: 0; }
.rgsec-note { margin-top: 30px; }

/* ---------- AI employees ---------- */
.rgai-card { max-width: 720px; margin: 44px auto 0; padding: clamp(24px, 4vw, 34px); }
.rgai-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.rgai-avatar { width: 56px; height: 56px; border-radius: 16px; flex-shrink: 0;
  background: linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%);
  display: flex; align-items: center; justify-content: center; font-size: 23px; font-weight: 800; color: #fff;
  box-shadow: 0 10px 30px -10px rgba(91,124,250,0.7); }
.rgai-name { font-size: 18px; font-weight: 700; color: #fff; margin: 0 0 4px; }
.rgai-role { font-size: 13px; color: #9aa5bd; margin: 0; }
.rgai-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: #2dd4a0;
  background: rgba(45,212,160,0.08); border: 1px solid rgba(45,212,160,0.25); border-radius: 999px; padding: 4px 11px; margin-left: auto; }
.rgai-status i { width: 7px; height: 7px; border-radius: 50%; background: #2dd4a0; animation: rg-pulse 1.8s infinite; }
.rgai-meta { display: flex; flex-wrap: wrap; gap: 10px 26px; margin-top: 20px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.06); }
.rgai-meta div { font-size: 12.5px; color: #6c7690; line-height: 1.6; }
.rgai-meta b { display: block; color: #c6cede; font-weight: 600; font-size: 13px; margin-top: 2px; }
.rgai-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 44px; }
.rgai-list { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 10px; }
.rgai-list li { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; color: #9aa5bd; line-height: 1.55; }
.rgai-list svg { flex-shrink: 0; margin-top: 2px; }
.rgai-can svg { color: #2dd4a0; }
.rgai-cant svg { color: #fb5670; }
.rgai-honest { margin-top: 30px; text-align: center; color: #c6cede; font-size: 14.5px; font-weight: 600; line-height: 1.6; }

/* ---------- integrations ---------- */
.rgint-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; margin-top: 44px; }
.rgint-tag { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  color: #a5b0ff; background: rgba(139,124,255,0.10); border: 1px solid rgba(139,124,255,0.22); border-radius: 999px; padding: 3px 10px; margin-bottom: 14px; }
.rgint-card h3 { font-size: 15px; }
.rgint-foot { margin-top: 30px; display: flex; flex-direction: column; gap: 10px; }
.rgint-line { display: flex; gap: 9px; align-items: flex-start; font-size: 13px; color: #9aa5bd; line-height: 1.65; }
.rgint-line svg { flex-shrink: 0; color: #a5b0ff; margin-top: 2px; }

/* ---------- help center ---------- */
.rhelp-search { display: flex; gap: 10px; max-width: 560px; margin: 30px auto 0; }
.rhelp-search .rgf-input { flex: 1; }
.rhelp-count { text-align: center; font-size: 12px; color: #6c7690; margin-top: 12px; }
.rhelp-cats { display: flex; flex-direction: column; gap: 40px; margin-top: 44px; }
.rhelp-cat h2 { font-size: 16px; color: #fff; font-weight: 700; margin: 0 0 14px; display: flex; align-items: center; gap: 10px; }
.rhelp-cat h2 svg { color: #a5b0ff; }
.rhelp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.rhelp-card { padding: 18px; }
.rhelp-card h3 { font-size: 13.5px; color: #eef1f7; margin: 0 0 7px; font-weight: 700; line-height: 1.4; }
.rhelp-card p { font-size: 12.5px; color: #8b96ad; line-height: 1.65; margin: 0; }
.rhelp-empty { text-align: center; color: #6c7690; padding: 48px 0 20px; font-size: 14px; line-height: 1.7; }

/* ---------- product page chips ---------- */
.rgchips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; justify-content: center; }
.rgchip { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: #b9c0d4;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 999px; padding: 8px 15px; }
.rgchip svg { color: #2dd4a0; flex-shrink: 0; }
.rg-links-row { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin-top: 26px; font-size: 13px; }
.rg-links-row a { color: #a5b0ff; text-decoration: none; }
.rg-links-row a:hover { text-decoration: underline; }

/* ---------- responsive ---------- */
@media (max-width: 1180px) {
  .rg-hide-md { display: none; }
}
@media (max-width: 1020px) {
  .rg-nav-links { display: none; }
  .rg-burger { display: flex; }
}
@media (max-width: 960px) {
  .rg-hero { grid-template-columns: 1fr; }
  .rg-cards, .rg-bento { grid-template-columns: 1fr 1fr; }
  .rg-bento .rg-wide { grid-column: span 2; }
  .rg-steps { grid-template-columns: 1fr 1fr; row-gap: 30px; }
  .rg-flows { grid-template-columns: 1fr; }
  .rgp-grid { grid-template-columns: 1fr; }
  .rgai-cols { grid-template-columns: 1fr; }
  .rgf-grid { grid-template-columns: 1fr; }
  .rg-footer-grid { grid-template-columns: 1fr 1fr; }
  .rgsec-grid { grid-template-columns: 1fr; }
  .rg-demo-grid { grid-template-columns: 1fr; }
  .rg-side-card { position: static; }
}
@media (max-width: 620px) {
  .rg-cards, .rg-bento { grid-template-columns: 1fr; }
  .rg-bento .rg-wide { grid-column: span 1; }
  .rg-steps { grid-template-columns: 1fr; }
  .rg-hero-cta .rg-btn { flex: 1; }
  .rg-footer-grid { grid-template-columns: 1fr; gap: 30px; }
  .rg-footer-bottom { flex-direction: column; }
  .dmc-log { height: 300px; }
  .dmc-msg { max-width: 94%; }
  .rg-mobile-actions { flex-direction: column; }
}
@media (max-width: 480px) {
  .rg-nav-actions .rg-btn-ghost { display: none; }
}

/* ---------- motion safety ---------- */
@media (prefers-reduced-motion: reduce) {
  .rg-float, .rg-pulse, .rgai-status i, .dmc-typing i { animation: none !important; }
  .rg-card, .rg-btn, .rg-flowstep { transition: none !important; }
}
`

/** Renders the shared scoped stylesheet. Server component — no client JS. */
export function SiteStyle() {
  return <style dangerouslySetInnerHTML={{ __html: SITE_CSS }} />
}
