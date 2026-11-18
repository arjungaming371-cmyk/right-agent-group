import type { MetadataRoute } from "next"

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/apply`, changeFrequency: "weekly", priority: 1 },
  ]
}
