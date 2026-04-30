import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
  ],
  serverExternalPackages: [
    "sharp",
    "pg-boss",
    "pdf-parse",
    "playwright",
    "playwright-core",
    "chromium-bidi",
    "@showbook/scrapers",
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(
        "sharp",
        "pdf-parse",
        "playwright",
        "playwright-core",
        "chromium-bidi",
      );
    }
    return config;
  },
};

export default nextConfig;
