/** @type {import("next").NextConfig} */
const nextConfig = {
  // (twilio was removed here — the project migrated to the self-hosted Exotel
  // voicebot and this package is no longer a dependency anywhere.)
  serverExternalPackages: ["ws"],
  experimental: {
    // "*" accepted a server action request claiming to come from any
    // origin — nothing in this codebase uses "use server" today, but a
    // future one would inherit that hole silently. Scoped to the domains
    // that actually serve this app instead.
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "127.0.0.1:3000",
        ...(process.env.NGROK_DOMAIN ? [process.env.NGROK_DOMAIN] : []),
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ]
  },
}
export default nextConfig
