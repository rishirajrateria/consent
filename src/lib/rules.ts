import { db } from "./db";
import type { MatrixPolicy } from "@prisma/client";

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
 * Evaluates a submitted request against the consenter's standing rules
 * (priority order), then the consent matrix defaults.
 * A decision applies only if it covers EVERY selected platform×format×asset
 * combination (auto-deny fires if ANY combination is Never allowed).
 */
export async function evaluateAutoDecision(opts: {
  consenterId: string;
  requester: { id: string; type: string; score: number; categories: string[] };
  selections: Selection[];
  assetTypeIds: string[];
}): Promise<AutoDecision> {
  const { consenterId, requester, selections, assetTypeIds } = opts;

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
      if (e.policy !== "AUTO_APPROVE") allAutoApprove = false;
      if (
        e.policy === "AUTO_APPROVE" &&
        e.maxDurationSec != null &&
        sel.durationSec != null &&
        sel.durationSec > e.maxDurationSec
      ) {
        allAutoApprove = false; // exceeds allowed duration → fall back to Ask
      }
    }
  }
  if (sawAny && allAutoApprove) return { kind: "matrix", policy: "AUTO_APPROVE" };
  return { kind: "none" };
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
