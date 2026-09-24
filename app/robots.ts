import type { MetadataRoute } from "next"

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The operations console and all APIs are session/secret protected —
        // keep crawlers out of them entirely (they'd only see login walls or
        // 401 JSON).
        disallow: ["/dashboard", "/api/", "/form/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
