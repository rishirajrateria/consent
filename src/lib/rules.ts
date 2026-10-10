import { db } from "./db";
import type { ConsentMatrixEntry, MatrixPolicy } from "@prisma/client";

export type Selection = {
  platformId: string;
  platformName: string;
  formatId: string;
  formatName: string;
  durationSec?: number | null;
};

export type RuleConditions = {
  platformIds?: string[];
  formatIds?: string[];
  assetTypeIds?: string[];
  maxDurationSec?: number;
  requesterTypes?: string[];
  minScore?: number;
  categories?: string[];
  whitelistOnly?: boolean;
};

export type AutoDecision =
  | { kind: "matrix"; policy: MatrixPolicy }
  | { kind: "rule"; action: "AUTO_APPROVE" | "AUTO_DENY" | "ROUTE_TO_MEMBER"; ruleId: string; ruleName: string; createdByName: string; createdAt: Date; routeToUserId?: string | null }
  | { kind: "none" };

/**
 * Evaluates a submitted request against the owner's standing rules
 * (priority order), then their consent matrix (their terms).
 * A decision applies only if it covers EVERY selected platform×format×asset
 * combination (auto-deny fires if ANY combination is Never allowed).
 */
export async function evaluateAutoDecision(opts: {
  consenterId: string;
  requester: { id: string; type: string; score: number; categories: string[] };
  selections: Selection[];
  assetTypeIds: string[];
  /** Whether the request's thumbnail uses the consenter. Omitted = assume it does (the safe side). */
  thumbnailUsed?: boolean;
}): Promise<AutoDecision> {
  const { consenterId, requester, selections, assetTypeIds } = opts;
  const thumbnailUsed = opts.thumbnailUsed ?? true;

  const whitelisted = !!(await db.listEntry.findUnique({
    where: { kind_consenterId_requesterId: { kind: "WHITELIST", consenterId, requesterId: requester.id } },
  }));

  // 1. Standing rules in priority order
  const rules = await db.standingRule.findMany({
    where: { consenterId, active: true },
    orderBy: { priority: "asc" },
  });
  for (const rule of rules) {
    const c = rule.conditions as RuleConditions;
    if (ruleMatches(c, { requester, selections, assetTypeIds, whitelisted })) {
      return {
        kind: "rule",
        action: rule.action,
        ruleId: rule.id,
        ruleName: rule.name,
        createdByName: rule.createdByName,
        createdAt: rule.createdAt,
        routeToUserId: rule.routeToUserId,
      };
    }
  }

  // 2. Consent matrix: check every combination
  const entries = await db.consentMatrixEntry.findMany({ where: { consenterId } });
  const lookup = new Map(entries.map((e) => [`${e.platformId}:${e.formatId}:${e.assetTypeId}`, e]));
  let allAutoApprove = entries.length > 0;
  let sawAny = false;
  for (const sel of selections) {
    for (const at of assetTypeIds) {
      const e = lookup.get(`${sel.platformId}:${sel.formatId}:${at}`);
      if (!e) {
        allAutoApprove = false; // unset cell defaults to Ask
        continue;
      }
      sawAny = true;
      if (e.policy === "AUTO_DENY") return { kind: "matrix", policy: "AUTO_DENY" };
      if (!cellAutoApproves(e, sel, thumbnailUsed)) allAutoApprove = false; // fall back to Ask
    }
  }
  if (sawAny && allAutoApprove) return { kind: "matrix", policy: "AUTO_APPROVE" };
  return { kind: "none" };
}

/**
 * Whether one matrix cell lets a request through without asking. A ✓ still
 * falls back to Ask when the clip is longer than the row's cap or when the
 * request uses a thumbnail the row doesn't allow.
 */
export function cellAutoApproves(
  e: Pick<ConsentMatrixEntry, "policy" | "maxDurationSec" | "thumbnailAllowed">,
  sel: Pick<Selection, "durationSec">,
  thumbnailUsed: boolean
): boolean {
  if (e.policy !== "AUTO_APPROVE") return false;
  if (e.maxDurationSec != null && sel.durationSec != null && sel.durationSec > e.maxDurationSec) return false;
  if (thumbnailUsed && !e.thumbnailAllowed) return false;
  return true;
}

export function ruleMatches(
  c: RuleConditions,
  ctx: {
    requester: { type: string; score: number; categories: string[] };
    selections: Selection[];
    assetTypeIds: string[];
    whitelisted: boolean;
  }
): boolean {
  if (c.whitelistOnly && !ctx.whitelisted) return false;
  if (c.requesterTypes?.length && !c.requesterTypes.includes(ctx.requester.type)) return false;
  if (c.minScore != null && ctx.requester.score < c.minScore) return false;
  if (c.categories?.length && !ctx.requester.categories.some((x) => c.categories!.includes(x)))
    return false;
  if (c.platformIds?.length && !ctx.selections.every((s) => c.platformIds!.includes(s.platformId)))
    return false;
  if (c.formatIds?.length && !ctx.selections.every((s) => c.formatIds!.includes(s.formatId)))
    return false;
  if (c.assetTypeIds?.length && !ctx.assetTypeIds.every((a) => c.assetTypeIds!.includes(a)))
    return false;
  if (
    c.maxDurationSec != null &&
    ctx.selections.some((s) => (s.durationSec ?? 0) > c.maxDurationSec!)
  )
    return false;
  return true;
}
