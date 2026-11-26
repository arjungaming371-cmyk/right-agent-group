// Verified login page — Google Sign-In only, restricted to allowlisted emails.
// Server component: reads ?error= and ?next= from the URL (Next 15 async searchParams).
import Image from "next/image"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Phone, MessageCircle, ShieldCheck, Sparkles } from "lucide-react"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token"
import OtpForm from "./otp-form"

export const dynamic = "force-dynamic"

const FEATURES = [
  { icon: Phone,         title: "AI Admissions Counsellor", desc: "Calls students & parents in English, Hinglish & Tenglish" },
  { icon: MessageCircle, title: "WhatsApp Automation",      desc: "Instant brochures, curriculum & NAT links" },
  { icon: ShieldCheck,   title: "Enterprise Admissions CRM",desc: "Lead pipeline, qualification tracking & audit log" },
]

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; otp?: string }>
}) {
  const params = await searchParams
  const error = params?.error
  // Default destination is the CONSOLE — "/" is now the public marketing
  // homepage, so after sign-in staff must land at /dashboard, not back on
  // the landing page.
  const next = params?.next && params.next.startsWith("/") && params.next !== "/" ? params.next : "/dashboard"
  const otpStep = params?.otp === "1"

  const cookieStore = await cookies()
  const existingSession = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)
  if (existingSession && !error && !otpStep) {
    redirect(next)
  }

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
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 flex items-center justify-center font-black text-white text-xl shadow-[0_0_25px_rgba(59,130,246,0.5)]">
              N
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-[22px] tracking-tight text-white">NIAT</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">ADMISSIONS</span>
              </div>
              <span className="text-[11px] text-[#94a3b8] font-medium tracking-wide">NxtWave Innovation in Advanced Technologies</span>
            </div>
          </div>
        </div>

        {/* Headline */}
        <div className="relative">
          <div
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-3.5 py-1.5 text-[12px] font-medium text-blue-400"
          >
            <Sparkles size={12} strokeWidth={2} />
            AI-powered technology admissions
          </div>
          <h1 className="max-w-[420px] text-[34px] font-bold leading-[1.15] tracking-tight text-white">
            Every inquiry answered.{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #a5b0ff, #5b7cfa 50%, #38bdf8)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              Every family guided.
            </span>
          </h1>
          <p className="mt-4 max-w-[400px] text-[14.5px] leading-relaxed text-[#9aa5bd]">
            NIAT AI Admissions Counsellor interacts with students and parents over phone, WhatsApp, and Instagram around the clock, explaining the 4-year curriculum, NAT assessment, and collaborating universities.
          </p>

          {/* Feature list */}
          <div className="mt-10 flex flex-col gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-blue-500/25 bg-blue-500/10 text-blue-400">
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
            © {new Date().getFullYear()} NIAT · NxtWave of Innovation in Advanced Technologies
          </div>
        </div>
      </section>

      {/* ===== Right — sign-in card ===== */}
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* Mobile-only brand (left panel hidden) */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <Image
              src="/logo.png"
              width={180}
              height={48}
              alt="Right Agent Group"
              className="h-10 w-auto object-contain"
            />
          </div>

          <div
            className="rounded-2xl border border-white/[0.06] p-8"
            style={{
              background: "rgba(14,19,32,0.75)",
              backdropFilter: "blur(18px) saturate(150%)",
              boxShadow: "0 24px 70px -18px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
          >
            <h2 className="text-[22px] font-bold tracking-tight text-white">{otpStep ? "Verification code" : "Welcome back"}</h2>
            <p className="mt-1.5 text-[13.5px] text-[#9aa5bd]">
              {otpStep ? "Enter the 6-digit verification code sent to your WhatsApp / Email" : "Sign in to access the operations console"}
            </p>

            {error && (
              <div className="mt-6 flex items-start gap-2.5 rounded-[10px] border border-[#fb5670]/30 bg-[#fb5670]/[0.08] px-4 py-3 text-[13px] leading-relaxed text-[#ff8fa0]">
                {error}
              </div>
            )}

            {otpStep ? <OtpForm /> : (
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
            )}

            <div className="mt-7 flex items-center gap-3">
              <div className="h-px flex-1 bg-white/[0.07]" />
              <span className="text-[10.5px] font-semibold tracking-[0.14em] text-[#64708c]">RESTRICTED ACCESS</span>
              <div className="h-px flex-1 bg-white/[0.07]" />
            </div>

            <p className="mt-5 text-center text-[12px] leading-relaxed text-[#64708c]">
              Only approved accounts can sign in. Contact administrator for access.
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
