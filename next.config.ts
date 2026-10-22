import type { NextConfig } from "next";

import { securityHeaders } from "./src/server/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: "security",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
