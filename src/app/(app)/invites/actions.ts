"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { email as emailProvider } from "@/lib/providers";
import { audit } from "@/lib/audit";
import { normalizeLegalName } from "@/lib/utils";

const inviteSchema = z.object({
  targetName: z.string().min(2).max(120),
  email: z.string().email().optional().or(z.literal("")),
  handle: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  returnTo: z.string().max(300).optional(),
});

/**
 * Invite a person/IP who isn't on Consent yet. Every invite for the same
 * name counts as demand; if an email is given, they receive an invitation.
 */
export async function sendAppInviteAction(formData: FormData) {
  const session = await getSession();
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  const back = parsed.success && parsed.data.returnTo?.startsWith("/") ? parsed.data.returnTo : "/directory";
  if (!session) redirect(`/signup`);
  if (!parsed.success)
    redirect(`${back}?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Check the invite form")}`);
  const d = parsed.data;
  const normalizedName = normalizeLegalName(d.targetName);
  if (!normalizedName)
    redirect(`${back}?error=${encodeURIComponent("Enter the person's or IP's name")}`);

  // Already here? Point the searcher at the live profile instead.
  const existing = await db.consenterProfile.findFirst({
    where: {
      status: "APPROVED",
      OR: [
        { normalizedLegalName: normalizedName },
        { displayName: { equals: d.targetName.trim(), mode: "insensitive" } },
        { aliases: { has: d.targetName.trim() } },
      ],
    },
  });
  if (existing) redirect(`/c/${existing.slug}`);

  await db.appInvite.upsert({
    where: { invitedById_normalizedName: { invitedById: session.userId, normalizedName } },
    update: {
      email: d.email || undefined,
      handle: d.handle || undefined,
      note: d.note || undefined,
    },
    create: {
      targetName: d.targetName.trim(),
      normalizedName,
      email: d.email || null,
      handle: d.handle || null,
      note: d.note || null,
      invitedById: session.userId,
    },
  });

  const demand = await db.appInvite.count({ where: { normalizedName, claimedAt: null } });

  if (d.email) {
    const base = process.env.APP_URL ?? "";
    const others = demand > 1 ? ` ${demand - 1} other${demand > 2 ? "s are" : " is"} waiting too.` : "";
    await emailProvider.send(
      d.email,
      `${session.user.name} wants your consent — not your content`,
      `Hi ${d.targetName.trim()},

${session.user.name} searched for you on Consent and wants to ask your permission before using your name, image or voice.${others}

Consent is where you set the terms for your own likeness: what's allowed, what's never allowed, and what it costs — platform by platform. Every approval becomes a signed, verifiable certificate. Verification is strict, and it costs you nothing.
${d.note ? `\nTheir note: "${d.note}"\n` : ""}
Claim your identity: ${base}/signup

— Consent · Your likeness. Your terms.`
    );
  }

  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "app_invite_sent",
    module: "invites",
    targetId: normalizedName,
    detail: { targetName: d.targetName.trim(), email: d.email || null, demand },
  });

  redirect(`${back}?invited=${encodeURIComponent(d.targetName.trim())}&demand=${demand}`);
}

/**
 * Claim loop: when a consenter profile is created (or verified), match open
 * invites by normalized name or the owner's login email, mark them claimed
 * and tell every inviter their person has arrived.
 */
export async function claimInvitesForConsenter(opts: {
  consenterId: string;
  displayName: string;
  normalizedLegalName: string;
  ownerEmail: string;
  stage: "joined" | "verified";
}) {
  const { notifyUser } = await import("@/lib/notify");
  const where =
    opts.stage === "joined"
      ? {
          claimedAt: null,
          OR: [
            { normalizedName: opts.normalizedLegalName },
            { normalizedName: normalizeLegalName(opts.displayName) },
            { email: { equals: opts.ownerEmail, mode: "insensitive" as const } },
          ],
        }
      : { claimedByConsenterId: opts.consenterId };
  const invites = await db.appInvite.findMany({ where });
  if (invites.length === 0) return;

  if (opts.stage === "joined") {
    await db.appInvite.updateMany({
      where: { id: { in: invites.map((i) => i.id) } },
      data: { claimedAt: new Date(), claimedByConsenterId: opts.consenterId },
    });
  }
  const message =
    opts.stage === "joined"
      ? {
          title: `${opts.displayName} just joined Consent`,
          body: "The person you invited has claimed their identity. You'll be able to send requests once they're verified.",
        }
      : {
          title: `${opts.displayName} is now verified`,
          body: "The person you asked for is live. You can send your consent request now.",
        };
  await Promise.all(
    [...new Set(invites.map((i) => i.invitedById))].map((userId) =>
      notifyUser({ userId, ...message, href: opts.stage === "verified" ? `/directory?q=${encodeURIComponent(opts.displayName)}` : "/notifications" })
    )
  );
}
