/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["twilio", "ws"],
  experimental: { serverActions: { allowedOrigins: ["*"] } },
}
export default nextConfig
