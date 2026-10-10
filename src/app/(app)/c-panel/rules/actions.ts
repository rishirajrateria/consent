"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter } from "@/lib/auth";
import { ensureAsker, isSelfAsk } from "@/lib/profiles";
import { audit } from "@/lib/audit";
import type { RuleAction } from "@prisma/client";
import type { RuleConditions } from "@/lib/rules";
import { seatPerms } from "../team/roles";

export async function createRuleAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canEditRules");
  const name = String(formData.get("name") ?? "").trim();
  const action = String(formData.get("action")) as RuleAction;
  if (!name || !["AUTO_APPROVE", "AUTO_DENY", "ROUTE_TO_MEMBER"].includes(action))
    redirect("/c-panel/rules?error=" + encodeURIComponent("Give the rule a name and choose what happens"));

  const conditions: RuleConditions = {};
  const platformIds = formData.getAll("platformIds").map(String).filter(Boolean);
  const formatIds = formData.getAll("formatIds").map(String).filter(Boolean);
  const assetTypeIds = formData.getAll("assetTypeIds").map(String).filter(Boolean);
  const requesterTypes = formData.getAll("requesterTypes").map(String).filter(Boolean);
  if (platformIds.length) conditions.platformIds = platformIds;
  if (formatIds.length) conditions.formatIds = formatIds;
  if (assetTypeIds.length) conditions.assetTypeIds = assetTypeIds;
  if (requesterTypes.length) conditions.requesterTypes = requesterTypes;
  const maxDur = parseInt(String(formData.get("maxDurationSec") ?? ""), 10);
  if (maxDur > 0) conditions.maxDurationSec = maxDur;
  const minScore = parseInt(String(formData.get("minScore") ?? ""), 10);
  if (minScore > 0) conditions.minScore = minScore;
  const categories = String(formData.get("categories") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (categories.length) conditions.categories = categories;
  if (formData.get("whitelistOnly") === "on") conditions.whitelistOnly = true;

  // A rule with no conditions matches every request, so it must never approve on its own.
  if (action === "AUTO_APPROVE" && Object.keys(conditions).length === 0)
    redirect("/c-panel/rules?error=" + encodeURIComponent("An auto-approve rule needs at least one condition"));

  const routeToUserId = String(formData.get("routeToUserId") ?? "") || null;
  if (action === "ROUTE_TO_MEMBER") {
    // Only someone who can answer may receive routed requests; anyone else is a dead end.
    const target = routeToUserId
      ? await db.consenterMember.findUnique({
          where: { consenterId_userId: { consenterId: consenter.id, userId: routeToUserId } },
        })
      : null;
    if (!target || !seatPerms(target).canApprove)
      redirect("/c-panel/rules?error=" + encodeURIComponent("Choose a team member who can approve requests"));
  }
  const last = await db.standingRule.findFirst({
    where: { consenterId: consenter.id },
    orderBy: { priority: "desc" },
  });
  await db.standingRule.create({
    data: {
      consenterId: consenter.id,
      name,
      priority: (last?.priority ?? 0) + 1,
      conditions: conditions as object,
      action,
      routeToUserId: action === "ROUTE_TO_MEMBER" ? routeToUserId : null,
      createdById: session.userId,
      createdByName: session.user.name,
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "standing_rule_created",
    module: "consent_settings",
    targetId: consenter.id,
    detail: { name, action },
  });
  redirect("/c-panel/rules?saved=1");
}

export async function toggleRuleAction(formData: FormData) {
  const { consenter } = await requireConsenter("canEditRules");
  const id = String(formData.get("id"));
  const rule = await db.standingRule.findUnique({ where: { id } });
  if (!rule || rule.consenterId !== consenter.id) redirect("/c-panel/rules");
  await db.standingRule.update({ where: { id }, data: { active: !rule.active } });
  redirect("/c-panel/rules");
}

export async function deleteRuleAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canEditRules");
  const id = String(formData.get("id"));
  const rule = await db.standingRule.findUnique({ where: { id } });
  if (!rule || rule.consenterId !== consenter.id) redirect("/c-panel/rules");
  await db.standingRule.delete({ where: { id } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "standing_rule_deleted",
    module: "consent_settings",
    targetId: consenter.id,
    detail: { name: rule.name },
  });
  redirect("/c-panel/rules");
}

export async function moveRuleAction(formData: FormData) {
  const { consenter } = await requireConsenter("canEditRules");
  const id = String(formData.get("id"));
  const dir = String(formData.get("dir"));
  const rules = await db.standingRule.findMany({
    where: { consenterId: consenter.id },
    orderBy: { priority: "asc" },
  });
  const idx = rules.findIndex((r) => r.id === id);
  const swapWith = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= rules.length) redirect("/c-panel/rules");
  await db.$transaction([
    db.standingRule.update({ where: { id: rules[idx].id }, data: { priority: rules[swapWith].priority } }),
    db.standingRule.update({ where: { id: rules[swapWith].id }, data: { priority: rules[idx].priority } }),
  ]);
  redirect("/c-panel/rules");
}

// ── Blacklist / whitelist ─────────────────────────────────────

/**
 * The profile a typed name, handle or profile link points to, as its sending
 * half (the one that asks). Public links are /c/<slug>; older /r/<slug> work too.
 */
async function askerFromInput(input: string) {
  const raw = input.trim();
  const path = raw.match(/\/(c|r)\/([^/?#\s]+)/);
  const slug = (path ? path[2] : raw).replace(/^@/, "");
  if (!slug) return null;
  if (path?.[1] !== "r") {
    const profile = await db.consenterProfile.findFirst({
      where: { OR: [{ slug }, { displayName: { equals: slug, mode: "insensitive" } }] },
      select: { id: true },
    });
    if (profile) return ensureAsker(profile.id);
  }
  return db.requesterProfile.findFirst({
    where: { OR: [{ slug }, { displayName: { equals: slug, mode: "insensitive" } }] },
  });
}

export async function addListEntryAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canEditRules");
  const kind = String(formData.get("kind")) === "WHITELIST" ? "WHITELIST" : "BLACKLIST";
  const note = String(formData.get("note") ?? "").trim().slice(0, 200) || null;
  const requester = await askerFromInput(String(formData.get("requester") ?? ""));
  if (!requester)
    redirect("/c-panel/lists?error=" + encodeURIComponent("No profile found with that name, handle or link"));
  if (isSelfAsk(consenter.id, requester))
    redirect("/c-panel/lists?error=" + encodeURIComponent("That's your own profile"));
  await db.listEntry.upsert({
    where: { kind_consenterId_requesterId: { kind, consenterId: consenter.id, requesterId: requester.id } },
    update: { note },
    create: { kind, consenterId: consenter.id, requesterId: requester.id, note },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: kind === "BLACKLIST" ? "requester_blacklisted" : "requester_whitelisted",
    module: "consent_settings",
    targetId: consenter.id,
    detail: { requester: requester.displayName },
  });
  redirect("/c-panel/lists?saved=1");
}

export async function removeListEntryAction(formData: FormData) {
  const { consenter } = await requireConsenter("canEditRules");
  const id = String(formData.get("id"));
  const entry = await db.listEntry.findUnique({ where: { id } });
  if (!entry || entry.consenterId !== consenter.id) redirect("/c-panel/lists");
  await db.listEntry.delete({ where: { id } });
  redirect("/c-panel/lists");
}
