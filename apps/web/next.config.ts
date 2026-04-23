import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@showbook/db",
    "@showbook/api",
    "@showbook/shared",
    "@showbook/jobs",
  ],
  serverExternalPackages: ["sharp", "pg-boss"],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push("sharp");
    }
    return config;
  },
};

export default nextConfig;
