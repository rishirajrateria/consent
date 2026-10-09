"use server";

import { z } from "zod";
import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, setActiveProfile } from "@/lib/auth";
import { storeUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { slugify, normalizeLegalName, shortId } from "@/lib/utils";
import { createPlatformPayment } from "@/lib/payments";
import type { ConsenterEntityType, RequesterType } from "@prisma/client";

function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

// ── Requester application ─────────────────────────────────────

const requesterSchema = z.object({
  legalName: z.string().min(2).max(200),
  displayName: z.string().min(2).max(100),
  type: z.enum(["INDIVIDUAL_CREATOR", "NEWS_CHANNEL", "PODCAST", "MEME_PAGE", "MEDIA_HOUSE", "AGENCY", "OTHER"]),
  country: z.string().min(2).max(8),
  description: z.string().min(20).max(4000),
  categories: z.string().max(500),
  signatoryName: z.string().max(200).optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().max(20).optional().or(z.literal("")),
});

export async function submitRequesterApplicationAction(formData: FormData) {
  const session = await requireUser();
  const parsed = requesterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    fail("/onboarding/requester", parsed.error.issues[0]?.message ?? "Check the form fields");
  const d = parsed.data;

  const platforms = formData.getAll("channelPlatform").map(String);
  const urls = formData.getAll("channelUrl").map(String);
  const followers = formData.getAll("channelFollowers").map(String);
  const channels = platforms
    .map((p, i) => ({ platform: p.trim(), url: urls[i]?.trim() ?? "", followers: parseInt(followers[i] || "0", 10) || 0 }))
    .filter((c) => c.platform && c.url);
  if (channels.length === 0) fail("/onboarding/requester", "Add at least one channel or handle link");

  const doc = formData.get("document") as File | null;
  if (!doc || doc.size === 0)
    fail("/onboarding/requester", "Upload your government ID or business registration document");

  const existing = await db.requesterMember.findFirst({ where: { userId: session.userId } });
  if (existing) fail("/onboarding/requester", "You already have a requester profile");

  const profile = await db.requesterProfile.create({
    data: {
      slug: `${slugify(d.displayName)}-${shortId(4)}`,
      displayName: d.displayName,
      legalName: d.legalName,
      type: d.type as RequesterType,
      country: d.country,
      description: d.description,
      categories: d.categories.split(",").map((c) => c.trim()).filter(Boolean),
      channels,
      signatoryName: d.signatoryName || null,
      contactEmail: d.contactEmail || session.user.email,
      contactPhone: d.contactPhone || session.user.phone,
      status: "SUBMITTED",
      members: { create: { userId: session.userId, role: "OWNER" } },
    },
  });
  await storeUpload({ file: doc, kind: "DOCUMENT", uploadedById: session.userId, requesterDocOf: profile.id });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "requester_application_submitted",
    module: "requesters",
    targetId: profile.id,
  });
  await setActiveProfile({ kind: "requester", id: profile.id });
  redirect("/onboarding/requester?submitted=1");
}

export async function payOnboardingAction() {
  const session = await requireUser();
  const member = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: true },
  });
  if (!member) redirect("/onboarding/requester");
  const r = member.requester;
  if (r.status !== "APPROVED") fail("/onboarding/requester", "Application not approved yet");
  if (r.onboardingFeePaidAt) redirect("/r-panel");
  const { checkoutUrl } = await createPlatformPayment({
    requesterId: r.id,
    purpose: "ONBOARDING",
    returnTo: "/r-panel?welcome=1",
  });
  redirect(checkoutUrl);
}

export async function payRenewalAction() {
  const session = await requireUser();
  const member = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: true },
  });
  if (!member) redirect("/dashboard");
  const { checkoutUrl } = await createPlatformPayment({
    requesterId: member.requesterId,
    purpose: "SUBSCRIPTION",
    returnTo: "/r-panel/billing?renewed=1",
  });
  redirect(checkoutUrl);
}

// ── Consenter onboarding ──────────────────────────────────────

const consenterSchema = z.object({
  entityType: z.enum(["PERSON", "TV_SHOW", "MOVIE", "WEB_SERIES", "BRAND", "FICTIONAL_CHARACTER", "BAND_GROUP", "SPORTS_TEAM", "OTHER"]),
  legalName: z.string().min(2).max(200),
  displayName: z.string().min(2).max(100),
  aliases: z.string().max(500).optional(),
  country: z.string().min(2).max(8),
  category: z.string().max(100).optional(),
  bio: z.string().max(2000).optional(),
  documentNumber: z.string().min(3).max(100),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().max(20).optional().or(z.literal("")),
  managerContact: z.string().max(200).optional(),
});

export async function submitConsenterApplicationAction(formData: FormData) {
  const session = await requireUser();
  const parsed = consenterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    fail("/onboarding/consenter", parsed.error.issues[0]?.message ?? "Check the form fields");
  const d = parsed.data;

  const doc = formData.get("document") as File | null;
  if (!doc || doc.size === 0)
    fail("/onboarding/consenter", "Upload identity / IP ownership documents");

  const handles = formData.getAll("socialPlatform").map(String);
  const handleNames = formData.getAll("socialHandle").map(String);
  const socials = handles
    .map((p, i) => ({ platformName: p.trim(), handle: handleNames[i]?.trim() ?? "" }))
    .filter((s) => s.platformName && s.handle);

  const existing = await db.consenterMember.findFirst({ where: { userId: session.userId } });
  if (existing) fail("/onboarding/consenter", "You already have a consenter profile");

  // One entity = one account: duplicate prevention signals
  const normalized = normalizeLegalName(d.legalName);
  const docHash = createHash("sha256").update(d.documentNumber.trim().toLowerCase()).digest("hex");
  const [nameDup, docDup, handleDup] = await Promise.all([
    db.consenterProfile.findFirst({ where: { normalizedLegalName: normalized } }),
    db.consenterProfile.findFirst({ where: { documentNumberHash: docHash } }),
    socials.length
      ? db.socialAccount.findFirst({
          where: {
            consenterId: { not: null },
            OR: socials.map((s) => ({ platformName: s.platformName, handle: s.handle })),
          },
        })
      : null,
  ]);
  const duplicateFlag = !!(nameDup || docDup || handleDup);

  const profile = await db.consenterProfile.create({
    data: {
      slug: `${slugify(d.displayName)}-${shortId(4)}`,
      displayName: d.displayName,
      legalName: d.legalName,
      normalizedLegalName: normalized,
      entityType: d.entityType as ConsenterEntityType,
      aliases: (d.aliases ?? "").split(",").map((a) => a.trim()).filter(Boolean),
      country: d.country,
      category: d.category || null,
      bio: d.bio || null,
      documentNumberHash: docHash,
      duplicateFlag,
      status: "SUBMITTED",
      shareEmail: formData.get("shareEmail") === "on",
      sharePhone: formData.get("sharePhone") === "on",
      shareManager: formData.get("shareManager") === "on",
      contactEmail: d.contactEmail || session.user.email,
      contactPhone: d.contactPhone || session.user.phone,
      managerContact: d.managerContact || null,
      members: {
        create: {
          userId: session.userId,
          role: "OWNER",
          canApprove: true,
          canNegotiate: true,
          canEditRules: true,
          canExport: true,
          canManageTeam: true,
        },
      },
      socialAccounts: {
        create: socials.map((s) => ({ ...s, verifiedVia: "manual" })),
      },
    },
  });
  await storeUpload({ file: doc, kind: "DOCUMENT", uploadedById: session.userId, consenterDocOf: profile.id });
  const photo = formData.get("photo") as File | null;
  if (photo && photo.size > 0) {
    const stored = await storeUpload({ file: photo, kind: "PROFILE_PHOTO", uploadedById: session.userId, consenterDocOf: profile.id });
    await db.consenterProfile.update({ where: { id: profile.id }, data: { photoFileId: stored.id } });
  }
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consenter_application_submitted",
    module: "consenters",
    targetId: profile.id,
    detail: { duplicateFlag },
  });
  // Close the loop with everyone who invited this person to Consent.
  const { claimInvitesForConsenter } = await import("@/app/(app)/invites/actions");
  await claimInvitesForConsenter({
    consenterId: profile.id,
    displayName: profile.displayName,
    normalizedLegalName: profile.normalizedLegalName,
    ownerEmail: session.user.email,
    stage: "joined",
  });
  await setActiveProfile({ kind: "consenter", id: profile.id });
  redirect("/onboarding/consenter?submitted=1");
}

/** Mock OAuth connect: marks a social account as verified via OAuth. */
export async function mockOauthConnectAction(formData: FormData) {
  const session = await requireUser();
  const accountId = String(formData.get("accountId") ?? "");
  const account = await db.socialAccount.findUnique({ where: { id: accountId } });
  if (!account) redirect("/dashboard");
  if (account.consenterId) {
    const member = await db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: account.consenterId, userId: session.userId } },
    });
    if (!member) redirect("/dashboard");
  }
  if (account.requesterId) {
    const member = await db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: account.requesterId, userId: session.userId } },
    });
    if (!member) redirect("/dashboard");
  }
  await db.socialAccount.update({
    where: { id: accountId },
    data: { verifiedVia: "oauth", verifiedAt: new Date() },
  });
  redirect(account.consenterId ? "/onboarding/consenter" : "/onboarding/requester");
}
