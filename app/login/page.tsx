// Verified login page — Google Sign-In only, restricted to allowlisted emails.
// Server component: reads ?error= and ?next= from the URL (Next 15 async searchParams).
import { Phone, MessageCircle, ShieldCheck, Sparkles } from "lucide-react"

export const dynamic = "force-dynamic"

const FEATURES = [
  { icon: Phone,         title: "AI Voice Agent",       desc: "Priya calls leads in English, Hinglish & Tenglish" },
  { icon: MessageCircle, title: "WhatsApp Automation",  desc: "Official Meta Cloud API — instant follow-ups" },
  { icon: ShieldCheck,   title: "Enterprise Security",  desc: "Signed sessions, audit trail, allowlisted access" },
]

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  const params = await searchParams
  const error = params?.error
  const next = params?.next && params.next.startsWith("/") ? params.next : "/"

  return (
    <main
      className="flex min-h-screen"
      style={{
        background:
          "radial-gradient(1000px 600px at 0% 0%, rgba(139,124,255,0.13), transparent 55%), radial-gradient(800px 500px at 100% 100%, rgba(56,189,248,0.09), transparent 55%), #05070c",
      }}
    >
      {/* ===== Left — brand panel ===== */}
      <section className="relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-[#1c2437] p-12 lg:flex">
        {/* subtle grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse 90% 80% at 30% 30%, black, transparent)",
          }}
        />

        {/* Brand */}
        <div className="relative flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[11px] text-[17px] font-extrabold text-white"
            style={{
              background: "linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%)",
              boxShadow: "0 6px 20px -4px rgba(91,124,250,0.6), inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
          >
            R
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-white">Right Agent Group</div>
            <div className="text-[9.5px] font-semibold tracking-[0.2em] text-[#64708c]">OPERATIONS CONSOLE</div>
          </div>
        </div>

        {/* Headline */}
        <div className="relative">
          <div
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#8b7cff]/25 bg-[#8b7cff]/10 px-3.5 py-1.5 text-[12px] font-medium text-[#a5b0ff]"
          >
            <Sparkles size={12} strokeWidth={2} />
            AI-powered loan operations
          </div>
          <h1 className="max-w-[420px] text-[34px] font-bold leading-[1.15] tracking-tight text-white">
            Every lead answered.{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #a5b0ff, #5b7cfa 50%, #38bdf8)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Every call handled.
            </span>
          </h1>
          <p className="mt-4 max-w-[400px] text-[14.5px] leading-relaxed text-[#9aa5bd]">
            Priya — your AI agent — qualifies leads over phone and WhatsApp around the clock,
            in three languages, and sends application links automatically.
          </p>

          {/* Feature list */}
          <div className="mt-10 flex flex-col gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#8b7cff]/25 bg-[#8b7cff]/10 text-[#a5b0ff]">
                  <Icon size={16} strokeWidth={1.9} />
                </span>
                <div>
                  <div className="text-[13.5px] font-semibold text-white">{title}</div>
                  <div className="text-[12.5px] text-[#64708c]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="relative space-y-2">
          <div className="text-[11.5px] text-[#64708c]">
            © {new Date().getFullYear()} Right Agent Group · Hyderabad
          </div>
          <a href="/about" className="inline-flex text-[11.5px] text-[#8b7cff] hover:text-[#a5b0ff] transition">
            About this Platform →
          </a>
        </div>
      </section>

      {/* ===== Right — sign-in card ===== */}
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* Mobile-only brand (left panel hidden) */}
          <div className="mb-10 flex items-center justify-center gap-3 lg:hidden">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-[11px] text-[17px] font-extrabold text-white"
              style={{ background: "linear-gradient(135deg, #8b7cff 0%, #5b7cfa 45%, #38bdf8 100%)" }}
            >
              R
            </div>
            <div className="leading-tight">
              <div className="text-[15px] font-bold text-white">Right Agent Group</div>
              <div className="text-[9.5px] font-semibold tracking-[0.2em] text-[#64708c]">OPERATIONS CONSOLE</div>
            </div>
          </div>

          <div
            className="rounded-2xl border border-white/[0.06] p-8"
            style={{
              background: "rgba(14,19,32,0.75)",
              backdropFilter: "blur(18px) saturate(150%)",
              boxShadow: "0 24px 70px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <h2 className="text-[22px] font-bold tracking-tight text-white">Welcome back</h2>
            <p className="mt-1.5 text-[13.5px] text-[#9aa5bd]">
              Sign in to access the operations console
            </p>

            {error && (
              <div className="mt-6 flex items-start gap-2.5 rounded-[10px] border border-[#fb5670]/30 bg-[#fb5670]/[0.08] px-4 py-3 text-[13px] leading-relaxed text-[#ff8fa0]">
                {error}
              </div>
            )}

            <a
              href={`/api/auth/google?next=${encodeURIComponent(next)}`}
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-[11px] bg-white px-4 py-[13px] text-[14px] font-semibold text-[#1a1d24] transition hover:bg-[#e8eaef]"
              style={{ boxShadow: "0 4px 18px -6px rgba(255,255,255,0.25)" }}
            >
              <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Continue with Google
            </a>

            <div className="mt-7 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.07]" />
              <span className="text-[10.5px] font-semibold tracking-[0.14em] text-[#64708c]">RESTRICTED ACCESS</span>
              <div className="h-px flex-1 bg-white/[0.07]" />
            </div>

            <p className="mt-5 text-center text-[12px] leading-relaxed text-[#64708c]">
              Only approved Google accounts can sign in.
              <br />
              Contact your administrator to request access.
            </p>
          </div>

          {/* Trust strip */}
          <div className="mt-6 flex items-center justify-center gap-2 text-[11.5px] text-[#64708c]">
            <ShieldCheck size={13} strokeWidth={1.9} className="text-[#2dd4a0]" />
            Protected by signed sessions & webhook signature verification
          </div>
        </div>
      </section>
    </main>
  )
}
