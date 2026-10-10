"use server";

import { z } from "zod";
import { createHash } from "crypto";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, requireRequester, setActiveProfile, hasAdminPerm } from "@/lib/auth";
import { storeUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify";
import { slugify, normalizeLegalName, shortId } from "@/lib/utils";
import { safeChannelUrl } from "@/lib/channels";
import { createPlatformPayment } from "@/lib/payments";
import type { ConsenterEntityType, RequesterType } from "@prisma/client";

function fail(path: string, error: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
}

/** Stores an uploaded document, or sends the person back with a plain error. */
async function storeOrFail(path: string, opts: Parameters<typeof storeUpload>[0]) {
  try {
    return await storeUpload(opts);
  } catch {
    // redirect() throws, so it must stay outside the try.
  }
  fail(path, "We couldn't take that file. Upload a PDF or an image.");
}

/** Reads the "reply to the review team" form; a reply or a document is required. */
function readReviewReply(formData: FormData, path: string) {
  const reply = String(formData.get("reply") ?? "").trim().slice(0, 2000);
  const doc = formData.get("document") as File | null;
  const file = doc && doc.size > 0 ? doc : null;
  if (!reply && !file) fail(path, "Write a reply or add a document");
  return { reply, file };
}

/** Tells every admin who can decide on this kind of application that it's back for review. */
async function notifyReviewers(module: "requesters" | "consenters", n: { title: string; body: string; href: string }) {
  const admins = await db.user.findMany({ where: { adminRoleId: { not: null } }, include: { adminRole: true } });
  await Promise.all(
    admins
      .filter((a) => hasAdminPerm(a.adminRole, module, "approve"))
      .map((a) => notifyUser({ userId: a.id, ...n }))
  );
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
  // Errors return to the form; "new=1" keeps it open for someone applying again after a rejection.
  const form = "/onboarding/requester?new=1";
  const parsed = requesterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    fail(form, parsed.error.issues[0]?.message ?? "Check the form fields");
  const d = parsed.data;

  const platforms = formData.getAll("channelPlatform").map(String);
  const urls = formData.getAll("channelUrl").map(String);
  const followers = formData.getAll("channelFollowers").map(String);
  const typed = platforms
    .map((p, i) => ({ platform: p.trim(), url: urls[i]?.trim() ?? "", followers: parseInt(followers[i] || "0", 10) || 0 }))
    .filter((c) => c.platform && c.url);
  // Channel links are shown to owners as clickable icons, so keep only real web addresses.
  if (typed.some((c) => !safeChannelUrl(c.url)))
    fail(form, "Channel links must be web addresses, like https://youtube.com/@yourchannel");
  const channels = typed.map((c) => ({ ...c, url: safeChannelUrl(c.url)! }));
  if (channels.length === 0) fail(form, "Add at least one channel or handle link");

  const doc = formData.get("document") as File | null;
  if (!doc || doc.size === 0)
    fail(form, "Upload your government ID or business registration document");

  const existing = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: true },
  });
  // After a rejection the owner may fix their details and apply again on the same profile.
  const reapply = existing?.role === "OWNER" && existing.requester.status === "REJECTED" ? existing.requester : null;
  if (existing && !reapply) fail("/onboarding/requester", "You already have a requester profile");

  const details = {
    displayName: d.displayName,
    legalName: d.legalName,
    type: d.type as RequesterType,
    country: d.country,
    description: d.description,
    categories: d.categories.split(",").map((c) => c.trim()).filter(Boolean),
    channels,
    signatoryName: d.signatoryName || null,
    status: "SUBMITTED" as const,
  };
  // Applying again keeps the ownership proof of any channel whose link didn't change.
  const prevAccounts = reapply ? await db.socialAccount.findMany({ where: { requesterId: reapply.id } }) : [];
  const proofByUrl = new Map(prevAccounts.map((a) => [a.url, a]));
  const socialAccounts = {
    create: channels.map((c) => {
      const prev = proofByUrl.get(c.url);
      return {
        platformName: c.platform,
        handle: c.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 120),
        url: c.url,
        followers: c.followers,
        verifiedVia: prev?.verifiedVia ?? "manual",
        verifiedAt: prev?.verifiedAt ?? null,
        proofFileId: prev?.proofFileId ?? null,
      };
    }),
  };
  const profile = reapply
    ? (
        await db.$transaction([
          db.socialAccount.deleteMany({ where: { requesterId: reapply.id } }),
          db.requesterProfile.update({
            where: { id: reapply.id },
            data: { ...details, adminNotes: null, socialAccounts },
          }),
        ])
      )[1]
    : await db.requesterProfile.create({
        data: {
          ...details,
          slug: `${slugify(d.displayName)}-${shortId(4)}`,
          contactEmail: d.contactEmail || session.user.email,
          contactPhone: d.contactPhone || session.user.phone,
          members: { create: { userId: session.userId, role: "OWNER" } },
          socialAccounts,
        },
      });
  await storeUpload({ file: doc, kind: "DOCUMENT", uploadedById: session.userId, requesterDocOf: profile.id });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: reapply ? "requester_application_resubmitted" : "requester_application_submitted",
    module: "requesters",
    targetId: profile.id,
  });
  await setActiveProfile({ kind: "requester", id: profile.id });
  redirect("/onboarding/requester?submitted=1");
}

/** Answers a "more information needed" message and sends the application back for review. */
export async function replyToRequesterReviewAction(formData: FormData) {
  const path = "/onboarding/requester";
  const session = await requireUser();
  const member = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: true },
  });
  if (!member || member.requester.status !== "MORE_INFO_NEEDED") redirect(path);
  if (member.role !== "OWNER") fail(path, "Only the account owner can reply to the review team");
  const r = member.requester;
  const { reply, file } = readReviewReply(formData, path);
  const stored = file
    ? await storeOrFail(path, { file, kind: "DOCUMENT", uploadedById: session.userId, requesterDocOf: r.id })
    : null;
  await db.requesterProfile.update({ where: { id: r.id }, data: { status: "SUBMITTED" } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "requester_info_sent",
    module: "requesters",
    targetId: r.id,
    reason: reply || null,
    detail: { documentId: stored?.id ?? null },
  });
  await notifyReviewers("requesters", {
    title: `${r.displayName} sent more information`,
    body: [reply, stored && "They added a new document."].filter(Boolean).join(" "),
    href: `/admin/requesters/${r.id}`,
  });
  redirect(`${path}?replied=1`);
}

export async function payOnboardingAction(formData: FormData) {
  const session = await requireUser();
  const member = await db.requesterMember.findFirst({
    where: { userId: session.userId },
    include: { requester: true },
  });
  if (!member) redirect("/onboarding/requester");
  if (member.role === "VIEWER") fail("/onboarding/requester", "Viewers have read-only access");
  const r = member.requester;
  if (r.status !== "APPROVED") fail("/onboarding/requester", "Application not approved yet");
  if (r.onboardingFeePaidAt) redirect("/r-panel");
  const { checkoutUrl } = await createPlatformPayment({
    requesterId: r.id,
    purpose: "ONBOARDING",
    couponCode: String(formData.get("coupon") ?? "").trim() || undefined,
    returnTo: "/r-panel?welcome=1",
  });
  redirect(checkoutUrl);
}

export async function payRenewalAction(formData: FormData) {
  // Renew the profile the billing page shows, not just the first one this user belongs to.
  const { member, requester } = await requireRequester();
  if (member.role === "VIEWER") fail("/r-panel/billing", "Viewers have read-only access");
  // Renewal extends an active account. Before activation, the onboarding payment covers the first year.
  if (requester.status !== "APPROVED" || !requester.onboardingFeePaidAt)
    fail("/r-panel/billing", "Activate your account first");
  const { checkoutUrl } = await createPlatformPayment({
    requesterId: requester.id,
    purpose: "SUBSCRIPTION",
    couponCode: String(formData.get("coupon") ?? "").trim() || undefined,
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

/** Answers a "more information needed" message and sends the profile back for verification. */
export async function replyToConsenterReviewAction(formData: FormData) {
  const path = "/onboarding/consenter";
  const session = await requireUser();
  const member = await db.consenterMember.findFirst({
    where: { userId: session.userId },
    include: { consenter: true },
  });
  if (!member || member.consenter.status !== "MORE_INFO_NEEDED") redirect(path);
  if (member.role !== "OWNER") fail(path, "Only the account owner can reply to the verification team");
  const c = member.consenter;
  const { reply, file } = readReviewReply(formData, path);
  const stored = file
    ? await storeOrFail(path, { file, kind: "DOCUMENT", uploadedById: session.userId, consenterDocOf: c.id })
    : null;
  await db.consenterProfile.update({ where: { id: c.id }, data: { status: "SUBMITTED" } });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consenter_info_sent",
    module: "consenters",
    targetId: c.id,
    reason: reply || null,
    detail: { documentId: stored?.id ?? null },
  });
  await notifyReviewers("consenters", {
    title: `${c.displayName} sent more information`,
    body: [reply, stored && "They added a new document."].filter(Boolean).join(" "),
    href: `/admin/consenters/${c.id}`,
  });
  redirect(`${path}?replied=1`);
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
