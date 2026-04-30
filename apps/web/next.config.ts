import type { NextConfig } from "next";

// Baseline security headers applied to every response. A full script-src CSP
// is intentionally omitted — Next.js 15 streams inline framework scripts that
// require nonces, which is its own follow-up. `frame-ancestors 'none'` gives
// us clickjacking protection without that lift.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "s1.ticketm.net" },
    ],
  },
  transpilePackages: [
    "@showbook/db",
    "@showbook/api",
    "@showbook/shared",
    "@showbook/jobs",
    "@showbook/emails",
    "@showbook/observability",
  ],
  serverExternalPackages: [
    "sharp",
    "pg-boss",
    "pdf-parse",
    "playwright",
    "playwright-core",
    "chromium-bidi",
    "@showbook/scrapers",
    "pino",
    "pino-pretty",
    "thread-stream",
    "@axiomhq/pino",
    "langfuse",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        "sharp",
        "pdf-parse",
        "playwright",
        "playwright-core",
        "chromium-bidi",
        "pino",
        "pino-pretty",
        "thread-stream",
        "@axiomhq/pino",
      );
    }
    return config;
  },
};

export default nextConfig;
