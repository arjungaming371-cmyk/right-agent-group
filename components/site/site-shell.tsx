import SiteNav from "./site-nav"
import SiteFooter from "./site-footer"
import { SiteStyle } from "./site-css"

// Shared chrome for every PUBLIC marketing page: dark root + background
// layers + the scoped .rg-* stylesheet + sticky nav + <main> landmark +
// footer. Server component — the only client islands inside are SiteNav's
// mobile toggle and whatever a page opts into (demo chat/form, EMI calc).
export default function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rg-root">
      <SiteStyle />
      <div className="rg-bg" aria-hidden="true" />
      <div className="rg-grid" aria-hidden="true" />
      <div className="rg-shell">
        <a href="#rg-main" className="rg-skip">
          Skip to content
        </a>
        <SiteNav />
        <main id="rg-main" className="rg-main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  )
}
