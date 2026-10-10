import "server-only";
import { db } from "./db";
import { Prisma } from "@prisma/client";
import { profileScore } from "./profiles-pure";

/**
 * One verified profile in search results (Find, the public directory, the
 * invite panel). Every profile can be asked, so every verified profile is
 * listed. `id` and `slug` are the profile's (its public page is /c/<slug>).
 */
export type ProfileHit = {
  id: string;
  slug: string;
  displayName: string;
  entityType: string;
  category: string | null;
  country: string;
  bio: string | null;
  aliases: string[];
  /** The one Consent Score people see (profileScore of the two halves). */
  score: number;
  /** How the profile answers requests (the receiving half's stored score). */
  receiveScore: number;
  /** How the profile asks (the sending half's stored score); null before it has one. */
  sendScore: number | null;
  /** The base consent request fee; null = free to ask. Per-intent tiers can differ. */
  consentPrice: string | null;
  consentPriceCurrency: string;
};

/** @deprecated Same as ProfileHit (every profile can receive and send). */
export type ConsenterHit = ProfileHit;

type Row = Omit<ProfileHit, "score" | "receiveScore"> & { score: number; rank?: number };

const withScore = (r: Row): ProfileHit => {
  const hit = { ...r, receiveScore: r.score, score: profileScore(r.score, r.sendScore) };
  delete hit.rank;
  return hit;
};

/** The Consent Score people see, in SQL: profileScore of the two halves (both round half up). */
const VISIBLE_SCORE = Prisma.sql`ROUND((c.score + COALESCE(r.score, c.score)) / 2.0)`;

const COLUMNS = Prisma.sql`
  c.id, c.slug, c."displayName", c."entityType"::text as "entityType",
  c.category, c.country, c.bio, c.score, c.aliases,
  c."consentPrice"::text as "consentPrice", c."consentPriceCurrency",
  r.score as "sendScore"`;

/**
 * Searches verified profiles by name, legal name, alias, handle (on either
 * half), kind, category (either half) using Postgres trigram similarity +
 * ILIKE (documented upgrade path: Meilisearch/Typesense behind this same
 * function). An empty query lists the best-scored profiles. Both sort by the
 * Consent Score each hit shows (after relevance for a query). Pass
 * `excludeIds` to leave profiles out (for example the viewer's own).
 */
export async function searchProfiles(
  q: string,
  limit = 24,
  opts: { excludeIds?: string[] } = {},
): Promise<ProfileHit[]> {
  const query = q.trim();
  const exclude = opts.excludeIds?.filter(Boolean) ?? [];
  const notIn = exclude.length ? Prisma.sql`AND c.id NOT IN (${Prisma.join(exclude)})` : Prisma.empty;
  if (!query) {
    const rows = await db.$queryRaw<Row[]>(Prisma.sql`
      SELECT ${COLUMNS}
      FROM "ConsenterProfile" c
      LEFT JOIN "RequesterProfile" r ON r."consenterId" = c.id
      WHERE c.status = 'APPROVED' ${notIn}
      ORDER BY ${VISIBLE_SCORE} DESC, c."createdAt" DESC, c.id
      LIMIT ${limit}
    `);
    return rows.map(withScore);
  }
  const like = `%${query}%`;
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT ${COLUMNS},
      GREATEST(
        similarity(c."displayName", ${query}),
        similarity(c."legalName", ${query}),
        COALESCE((SELECT MAX(similarity(a, ${query})) FROM unnest(c.aliases) a), 0),
        COALESCE((
          SELECT MAX(similarity(s.handle, ${query})) FROM "SocialAccount" s
          WHERE s."consenterId" = c.id OR (r.id IS NOT NULL AND s."requesterId" = r.id)
        ), 0)
      ) AS rank
    FROM "ConsenterProfile" c
    LEFT JOIN "RequesterProfile" r ON r."consenterId" = c.id
    WHERE c.status = 'APPROVED' ${notIn} AND (
      c."displayName" ILIKE ${like}
      OR c."legalName" ILIKE ${like}
      OR c.category ILIKE ${like}
      OR c."entityType"::text ILIKE ${like}
      OR EXISTS (SELECT 1 FROM unnest(c.aliases) a WHERE a ILIKE ${like})
      OR EXISTS (SELECT 1 FROM unnest(r.categories) rc WHERE rc ILIKE ${like})
      OR EXISTS (
        SELECT 1 FROM "SocialAccount" s
        WHERE (s."consenterId" = c.id OR (r.id IS NOT NULL AND s."requesterId" = r.id)) AND s.handle ILIKE ${like}
      )
      OR similarity(c."displayName", ${query}) > 0.25
    )
    ORDER BY rank DESC, ${VISIBLE_SCORE} DESC, c.id
    LIMIT ${limit}
  `);
  return rows.map(withScore);
}

/** @deprecated Same as searchProfiles. Kept so existing callers keep working. */
export const searchConsenters = searchProfiles;
