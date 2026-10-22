import type { MetadataRoute } from "next";

import { siteConfig } from "@/lib/site-data";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/admin", "/dev", "/api", "/accept-invite"],
    },
    sitemap: new URL("/sitemap.xml", siteConfig.url).toString(),
  };
}
