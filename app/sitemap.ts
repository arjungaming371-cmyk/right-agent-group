import type { MetadataRoute } from "next"

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")

// Public, indexable surfaces only. /dashboard, /form/* and the APIs are
// session-protected or webhook-only and deliberately excluded. /login is
// noindex via its layout, so it stays out of the sitemap too.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/product`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/demo`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/ai-employees`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/integrations`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/security`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/help`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ]
}
