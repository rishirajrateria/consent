import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  // Every verified profile has one public page, /c/<slug> (/r/<slug> redirects there).
  const profiles = await db.consenterProfile.findMany({
    where: { status: "APPROVED" },
    select: { slug: true, updatedAt: true },
    take: 5000,
  });
  const staticPages = ["", "/home", "/how-it-works", "/pricing", "/directory", "/verify", "/faq", "/terms", "/privacy", "/contact"];
  return [
    ...staticPages.map((p) => ({ url: `${base}${p}`, changeFrequency: "weekly" as const })),
    ...profiles.map((c) => ({
      url: `${base}/c/${c.slug}`,
      lastModified: c.updatedAt,
      changeFrequency: "weekly" as const,
    })),
  ];
}
