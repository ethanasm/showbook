import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@showbook/db",
    "@showbook/api",
    "@showbook/shared",
    "@showbook/jobs",
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
