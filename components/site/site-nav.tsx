"use client"

// Sticky translucent marketing nav. Links hide progressively (<=1180px drops
// the least-important anchors via .rg-hide-md, <=1020px collapses to the
// hamburger). The slide-down mobile menu is the only client state here.
import Link from "next/link"
import { useEffect, useState } from "react"
import { Menu, X } from "lucide-react"

const LINKS = [
  { href: "/product", label: "Product", hideMd: false },
  { href: "/#how", label: "How It Works", hideMd: false },
  { href: "/ai-employees", label: "AI Employees", hideMd: false },
  { href: "/integrations", label: "Integrations", hideMd: true },
  { href: "/security", label: "Security", hideMd: false },
  { href: "/pricing", label: "Pricing", hideMd: false },
  { href: "/about", label: "About", hideMd: true },
]

export default function SiteNav({ ctaHref = "/demo" }: { ctaHref?: string }) {
  const [open, setOpen] = useState(false)

  // Close the menu on Escape so keyboard users are never trapped.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <header className="rg-navwrap">
      <nav className="rg-nav" aria-label="Main navigation">
        <Link href="/" className="rg-brand" aria-label="Right Agent Group — home">
          <span className="rg-brand-mark" aria-hidden="true">
            R
          </span>
          <span className="rg-brand-name">Right Agent Group</span>
        </Link>

        <div className="rg-nav-links">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={l.hideMd ? "rg-hide-md" : undefined}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="rg-nav-actions">
          <Link href="/login" className="rg-btn rg-btn-ghost rg-btn-sm">
            Login
          </Link>
          <Link href={ctaHref} className="rg-btn rg-btn-primary rg-btn-sm">
            Book a Demo
          </Link>
          <button
            type="button"
            className="rg-burger"
            aria-expanded={open}
            aria-controls="rg-mobile-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={19} strokeWidth={2} /> : <Menu size={19} strokeWidth={2} />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="rg-mobile" id="rg-mobile-menu">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rg-mobile-link"
              onClick={() => setOpen(false)}
            >
              {l.label}
            </Link>
          ))}
          <div className="rg-mobile-actions">
            <Link href="/login" className="rg-btn rg-btn-ghost rg-btn-sm" onClick={() => setOpen(false)}>
              Login
            </Link>
            <Link href={ctaHref} className="rg-btn rg-btn-primary rg-btn-sm" onClick={() => setOpen(false)}>
              Book a Demo
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
