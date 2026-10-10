import "server-only";
import { db } from "@/lib/db";
import type { ProfileHit } from "@/lib/search";
import { requestCapacity, type Capacity } from "@/lib/capacity";
import { feeLine, type FeeLine } from "./asking";

/**
 * What each result card shows besides the name: the consent request fee line
 * ("Free to ask" or the fee plus the platform fee) and, for profiles whose
 * request limits are reached, why new requests are paused.
 */
export async function resultDetails(results: ProfileHit[]) {
  if (!results.length) return { fees: new Map<string, FeeLine>(), paused: new Map<string, Capacity>() };
  const ids = results.map((c) => c.id);
  const [tiers, intents, limited] = await Promise.all([
    db.consentPriceTier.findMany({
      where: { consenterId: { in: ids } },
      select: { consenterId: true, intentCategoryId: true, amount: true },
    }),
    db.intentCategory.findMany({ where: { active: true }, select: { id: true } }),
    // Only profiles with a limit set can be paused, so only those are checked.
    db.consenterProfile.findMany({
      where: {
        id: { in: ids },
        OR: [
          { maxOpenRequests: { not: null } },
          { dailyRequestLimit: { not: null } },
          { weeklyRequestLimit: { not: null } },
          { monthlyRequestLimit: { not: null } },
        ],
      },
      select: { id: true },
    }),
  ]);
  const intentIds = intents.map((i) => i.id);
  const fees = new Map<string, FeeLine>(
    results.map((c) => [
      c.id,
      feeLine(
        c,
        tiers
          .filter((t) => t.consenterId === c.id)
          .map((t) => ({ intentCategoryId: t.intentCategoryId, amount: t.amount.toString() })),
        intentIds,
      ),
    ]),
  );
  const paused = new Map<string, Capacity>(
    (await Promise.all(limited.map(async ({ id }) => [id, await requestCapacity(id)] as const))).filter(
      ([, capacity]) => capacity.paused,
    ),
  );
  return { fees, paused };
}
