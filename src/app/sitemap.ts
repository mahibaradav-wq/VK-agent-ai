import type { MetadataRoute } from "next";

import { blogPosts, featurePages, siteConfig } from "@/lib/site-data";

const staticPaths = [
  "/",
  "/features",
  "/pricing",
  "/faq",
  "/blog",
  "/help",
  "/contacts",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/privacy",
  "/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const featurePaths = featurePages.map((feature) => `/features/${feature.slug}`);
  const articlePaths = blogPosts.map((post) => `/blog/${post.slug}`);

  return [...staticPaths, ...featurePaths, ...articlePaths].map((path) => ({
    url: new URL(path, siteConfig.url).toString(),
    lastModified: new Date("2026-10-11"),
  }));
}
