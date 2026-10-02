import Link from "next/link"
import { PhoneCall, MessageCircle, ScrollText, ShieldCheck, Clock } from "lucide-react"
import SiteShell from "@/components/site/site-shell"
import DemoForm from "@/components/site/demo-form"

// "Book a Demo" — conversion page. The form island posts to the public,
// rate-limited /api/demo endpoint; the sidebar sets honest expectations
// about what the demo actually shows.
export default function DemoPage() {
  return (
    <SiteShell>
      <div className="rgpage">
        <span className="rg-eyebrow">
          <Clock size={12} strokeWidth={2} /> Usually a reply within one business day
        </span>
        <h1>
          See Priya <span className="rg-grad">call your leads.</span>
        </h1>
        <p className="rg-lead">
          Leave your details and our team will call you to schedule a demo — a live AI
          qualification call against your own use case, not a canned recording.
        </p>
      </div>

      <section className="rg-section" style={{ paddingTop: 40 }}>
        <div className="rg-demo-grid">
          <DemoForm />

          <aside className="rg-glass rg-side-card" aria-label="What you'll see in the demo">
            <h2>What you&apos;ll see</h2>
            <ul className="rg-side-list">
              <li>
                <PhoneCall size={16} strokeWidth={2} />
                <span>A live qualification call — Priya asking your questions, in your language.</span>
              </li>
              <li>
                <MessageCircle size={16} strokeWidth={2} />
                <span>WhatsApp follow-up — the application link and nudges customers receive.</span>
              </li>
              <li>
                <ScrollText size={16} strokeWidth={2} />
                <span>Your own script and knowledge base — grounded answers, not improvisation.</span>
              </li>
              <li>
                <ShieldCheck size={16} strokeWidth={2} />
                <span>Branch and role controls — who sees what, and the one-click AI pause.</span>
              </li>
            </ul>
            <p className="rg-side-note">
              The demo runs on our sample data. Nothing is dialed to your customers until you
              connect your own numbers and approve the script.
            </p>
          </aside>
        </div>

        <p className="rg-flowline" style={{ marginTop: 44 }}>
          Prefer to try first?{" "}
          <Link href="/#demo" className="rg-grad" style={{ textDecoration: "none", fontWeight: 700 }}>
            Test Priya in your browser
          </Link>
        </p>
      </section>
    </SiteShell>
  )
}
