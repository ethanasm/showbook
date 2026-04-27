import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@showbook/db",
    "@showbook/api",
    "@showbook/shared",
    "@showbook/jobs",
  ],
  serverExternalPackages: ["sharp", "pg-boss", "pdf-parse"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push("sharp", "pdf-parse");
    }
    return config;
  },
};

export default nextConfig;
