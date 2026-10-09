import "server-only";
import { db } from "./db";
import { Prisma } from "@prisma/client";

export type ConsenterHit = {
  id: string;
  slug: string;
  displayName: string;
  entityType: string;
  category: string | null;
  country: string;
  score: number;
  aliases: string[];
};

/**
 * Searches verified consenters by name, alias, handle, entity type or category
 * using Postgres trigram similarity + ILIKE (documented upgrade path:
 * Meilisearch/Typesense behind this same function).
 */
export async function searchConsenters(q: string, limit = 24): Promise<ConsenterHit[]> {
  const query = q.trim();
  if (!query) {
    return db.consenterProfile.findMany({
      where: { status: "APPROVED" },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { id: true, slug: true, displayName: true, entityType: true, category: true, country: true, score: true, aliases: true },
    });
  }
  const like = `%${query}%`;
  return db.$queryRaw<ConsenterHit[]>(Prisma.sql`
    SELECT DISTINCT ON (c.id)
      c.id, c.slug, c."displayName", c."entityType"::text as "entityType",
      c.category, c.country, c.score, c.aliases,
      GREATEST(
        similarity(c."displayName", ${query}),
        similarity(c."legalName", ${query}),
        COALESCE((SELECT MAX(similarity(a, ${query})) FROM unnest(c.aliases) a), 0),
        COALESCE((SELECT MAX(similarity(s.handle, ${query})) FROM "SocialAccount" s WHERE s."consenterId" = c.id), 0)
      ) AS rank
    FROM "ConsenterProfile" c
    WHERE c.status = 'APPROVED' AND (
      c."displayName" ILIKE ${like}
      OR c."legalName" ILIKE ${like}
      OR c.category ILIKE ${like}
      OR c."entityType"::text ILIKE ${like}
      OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE ${like})
      OR EXISTS (SELECT 1 FROM "SocialAccount" s WHERE s."consenterId" = c.id AND s.handle ILIKE ${like})
      OR similarity(c."displayName", ${query}) > 0.25
    )
    ORDER BY c.id, rank DESC
    LIMIT ${limit}
  `).then((rows) => rows.sort((a, b) => ((b as ConsenterHit & { rank?: number }).rank ?? 0) - ((a as ConsenterHit & { rank?: number }).rank ?? 0)));
}
