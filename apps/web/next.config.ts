import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@showbook/db",
    "@showbook/api",
    "@showbook/shared",
    "@showbook/jobs",
  ],
};

export default nextConfig;
