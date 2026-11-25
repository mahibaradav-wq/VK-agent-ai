import type { NextConfig } from "next";

import { securityHeaders } from "./src/server/security/headers";

function serverActionOrigins() {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.AUTH_URL || "http://localhost:3000";
  try {
    const host = new URL(raw).host;
    const apex = host.replace(/^www\./, "");
    return Array.from(new Set([host, apex, `www.${apex}`, "localhost:3000"]));
  } catch {
    return ["localhost:3000"];
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    agentUpgrade: "security",
    serverActions: {
      allowedOrigins: serverActionOrigins(),
      // Must cover MAX_VIDEO_BYTES (32 MiB) from media file-validation.
      bodySizeLimit: "32mb",
    },
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
