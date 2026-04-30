import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
