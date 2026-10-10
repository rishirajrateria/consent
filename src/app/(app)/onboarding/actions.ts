"use server";

import { createHash } from "crypto";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser, requireRequester, setActiveProfile, hasAdminPerm } from "@/lib/auth";
import { mirrorMember, syncPair } from "@/lib/profiles";
import { storeUpload } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { startMembershipCheckout } from "@/lib/payments";
import { activeCurrencies } from "@/lib/currencies";
import { slugify, normalizeLegalName, shortId } from "@/lib/utils";
import { channelHandle, echoValues, readApplication, type ApplicationState } from "./application";

type Tx = Prisma.TransactionClient;

function fail(path: string, error: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);
}

/** Stores an uploaded file, or null when it can't be taken (wrong type, too big). */
async function tryStore(opts: Parameters<typeof storeUpload>[0]) {
  try {
    return await storeUpload(opts);
  } catch {
    return null;
  }
}

/**
 * Tells every admin who can decide ID checks. "consenters" is the ID-check
 * module; older roles may still carry the retired "requesters" key.
 */
async function notifyReviewers(n: { title: string; body: string; href: string }) {
  const admins = await db.user.findMany({ where: { adminRoleId: { not: null } }, include: { adminRole: true } });
  await Promise.all(
    admins
      .filter((a) => hasAdminPerm(a.adminRole, "consenters", "approve") || hasAdminPerm(a.adminRole, "requesters", "approve"))
      .map((a) => notifyUser({ userId: a.id, ...n })),
  );
}

/** A slug for the sending half: the profile's own slug when free there. */
async function askerSlug(tx: Tx, base: string) {
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${shortId(3)}`;
    if (!(await tx.requesterProfile.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** The owner's seat: every permission. */
const OWNER_SEAT = { role: "OWNER" as const, canApprove: true, canEditRules: true, canExport: true, canManageTeam: true };

// ── The one ID check ──────────────────────────────────────────

/**
 * The single onboarding form. Creates the profile as a pair in one
 * transaction: the profile (receiving half) and its sending half, an OWNER
 * seat in both member tables, the ID document linked to both, and the
 * channels on both. The status is SUBMITTED, and the review team is told.
 * After a rejection the owner sends the same profile again (reapplyId).
 */
export async function submitProfileApplicationAction(
  prev: ApplicationState,
  formData: FormData,
): Promise<ApplicationState> {
  const session = await requireUser();
  // Email and phone are proven at sign-up, and 2FA is on, before the ID check.
  if (!session.user.phoneVerified) redirect("/verify-phone?next=%2Fonboarding");
  if (!session.user.totpEnabled) redirect("/settings/security?next=%2Fonboarding");
  const values = echoValues(formData);
  const answer = (error: string): ApplicationState => ({ error, values, attempt: prev.attempt + 1 });

  const currencies = await activeCurrencies();
  const read = readApplication(formData, currencies);
  if (!read.ok) return answer(read.error);
  const d = read.data;
  const userId = session.userId;

  // Sending a rejected profile again: only its owner, only after a rejection.
  const reapplyId = String(formData.get("reapplyId") ?? "").trim() || null;
  const reapply = reapplyId
    ? await db.consenterMember.findUnique({
        where: { consenterId_userId: { consenterId: reapplyId, userId } },
        include: { consenter: { include: { asker: true, socialAccounts: true } } },
      })
    : null;
  if (reapplyId && (!reapply || reapply.role !== "OWNER" || reapply.consenter.status !== "REJECTED"))
    return answer("This profile can't be sent again. Start a new profile instead.");
  const again = reapply?.consenter ?? null;

  // Files first, so a file we can't take never leaves a half-made profile.
  const document = await tryStore({
    // The document type travels in the file name, so the review team sees it next to the file.
    file: new File([d.document], `${d.documentType} - ${d.document.name}`, { type: d.document.type }),
    kind: "DOCUMENT",
    uploadedById: userId,
    maxMb: 25,
  });
  if (!document) return answer("We couldn't take the ID document. Upload a PDF or an image up to 25 MB.");
  const photo = await tryStore({ file: d.photo, kind: "PROFILE_PHOTO", uploadedById: userId, maxMb: 10 });
  if (!photo) return answer("We couldn't take the profile photo. Upload an image up to 10 MB.");

  // One identity, one profile: flag anything that looks like a profile we already have.
  const normalized = normalizeLegalName(d.legalName);
  const docHash = createHash("sha256").update(d.documentNumber.trim().toLowerCase()).digest("hex");
  const notThis = again ? { id: { not: again.id } } : {};
  const handles = d.channels.map((c) => channelHandle(c.url));
  const [nameDup, docDup, handleDup] = await Promise.all([
    db.consenterProfile.findFirst({ where: { normalizedLegalName: normalized, ...notThis }, select: { id: true } }),
    db.consenterProfile.findFirst({ where: { documentNumberHash: docHash, ...notThis }, select: { id: true } }),
    db.socialAccount.findFirst({
      where: {
        AND: [
          { consenterId: { not: null } },
          ...(again ? [{ consenterId: { not: again.id } }] : []),
          {
            OR: [
              { url: { in: d.channels.map((c) => c.url) } },
              ...handles.map((h) => ({ handle: { equals: h, mode: "insensitive" as const } })),
            ],
          },
        ],
      },
      select: { id: true },
    }),
  ]);
  const duplicateFlag = !!(nameDup || docDup || handleDup);

  const shared = {
    displayName: d.displayName,
    legalName: d.legalName,
    country: d.country,
  };
  const profileData = {
    ...shared,
    normalizedLegalName: normalized,
    entityType: d.entityType,
    aliases: d.aliases,
    category: d.category,
    bio: d.bio,
    photoFileId: photo.id,
    documentNumberHash: docHash,
    duplicateFlag,
    // The fee and the receive limit chosen in the form (sending again updates them too).
    consentPrice: d.consentPrice,
    consentPriceCurrency: d.consentPriceCurrency,
    ...d.limits,
    status: "SUBMITTED" as const,
    verifiedAt: null,
    adminNotes: null,
  };
  const askerData = {
    ...shared,
    type: d.creatorType,
    description: d.bio,
    categories: [d.category],
    channels: d.channels,
    status: "SUBMITTED" as const,
    approvedAt: null,
    adminNotes: null,
  };
  // Sending again keeps the ownership proof of any channel whose link didn't change.
  const proofByUrl = new Map((again?.socialAccounts ?? []).filter((a) => a.url).map((a) => [a.url!, a]));

  const profile = await db.$transaction(async (tx) => {
    const c = again
      ? await tx.consenterProfile.update({ where: { id: again.id }, data: profileData })
      : await tx.consenterProfile.create({
          data: {
            ...profileData,
            slug: `${slugify(d.displayName)}-${shortId(4)}`,
            members: { create: { userId, ...OWNER_SEAT } },
          },
        });
    const existing = await tx.requesterProfile.findUnique({ where: { consenterId: c.id }, select: { id: true } });
    const asker = existing
      ? await tx.requesterProfile.update({ where: { id: existing.id }, data: askerData })
      : await tx.requesterProfile.create({ data: { ...askerData, consenterId: c.id, slug: await askerSlug(tx, c.slug) } });

    // The team sits in both member tables.
    const members = await tx.consenterMember.findMany({ where: { consenterId: c.id } });
    for (const m of members) await mirrorMember(m, tx);

    // Channels: one row each, on both halves.
    await tx.socialAccount.deleteMany({
      where: { OR: [{ consenterId: c.id }, { requesterId: asker.id }] },
    });
    await tx.socialAccount.createMany({
      data: d.channels.map((ch) => {
        const prevProof = proofByUrl.get(ch.url);
        return {
          platformName: ch.platform,
          handle: channelHandle(ch.url),
          url: ch.url,
          followers: ch.followers,
          verifiedVia: prevProof?.verifiedVia ?? "manual",
          verifiedAt: prevProof?.verifiedAt ?? null,
          proofFileId: prevProof?.proofFileId ?? null,
          consenterId: c.id,
          requesterId: asker.id,
        };
      }),
    });

    // The ID document belongs to both halves; the photo to the profile.
    await tx.storedFile.update({
      where: { id: document.id },
      data: { consenterDocOf: c.id, requesterDocOf: asker.id },
    });
    await tx.storedFile.update({ where: { id: photo.id }, data: { consenterDocOf: c.id } });
    return { ...c, askerId: asker.id };
  });

  await audit({
    actorId: userId,
    actorName: session.user.name,
    action: again ? "profile_application_resubmitted" : "profile_application_submitted",
    module: "consenters",
    targetId: profile.id,
    detail: { duplicateFlag, documentType: d.documentType, requesterId: profile.askerId },
  });
  if (!again) {
    // Close the loop with everyone who invited this person to Consent.
    const { claimInvitesForConsenter } = await import("@/app/(app)/invites/claim");
    await claimInvitesForConsenter({
      consenterId: profile.id,
      displayName: profile.displayName,
      normalizedLegalName: profile.normalizedLegalName,
      ownerEmail: session.user.email,
      stage: "joined",
    });
  }
  await notifyReviewers({
    title: again ? `${profile.displayName} applied again` : `New ID check: ${profile.displayName}`,
    body: duplicateFlag
      ? "This may be a duplicate of a profile we already have. Check it before you approve."
      : "Their documents and channels are ready to review.",
    href: `/admin/consenters/${profile.id}`,
  });
  await setActiveProfile({ kind: "consenter", id: profile.id });
  redirect(`/onboarding?submitted=1&profile=${profile.id}`);
}

/** Answers a "more information needed" message and sends the profile back for review. */
export async function replyToReviewAction(formData: FormData) {
  const session = await requireUser();
  const profileId = String(formData.get("profileId") ?? "");
  const path = `/onboarding?profile=${encodeURIComponent(profileId)}`;
  const member = profileId
    ? await db.consenterMember.findUnique({
        where: { consenterId_userId: { consenterId: profileId, userId: session.userId } },
        include: { consenter: { include: { asker: { select: { id: true } } } } },
      })
    : null;
  if (!member || member.consenter.status !== "MORE_INFO_NEEDED") redirect(path);
  if (member.role !== "OWNER") fail(path, "Only the profile owner can reply to the review team.");
  const c = member.consenter;

  const reply = String(formData.get("reply") ?? "").trim().slice(0, 2000);
  const doc = formData.get("document");
  const file = doc && typeof doc !== "string" && doc.size > 0 ? doc : null;
  if (!reply && !file) fail(path, "Write a reply or add a document.");
  const stored = file
    ? await tryStore({
        file,
        kind: "DOCUMENT",
        uploadedById: session.userId,
        consenterDocOf: c.id,
        requesterDocOf: c.asker?.id,
        maxMb: 25,
      })
    : null;
  if (file && !stored) fail(path, "We couldn't take that file. Upload a PDF or an image up to 25 MB.");

  await db.$transaction(async (tx) => {
    await tx.consenterProfile.update({ where: { id: c.id }, data: { status: "SUBMITTED" } });
    await syncPair(c.id, tx);
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "profile_info_sent",
    module: "consenters",
    targetId: c.id,
    reason: reply || null,
    detail: { documentId: stored?.id ?? null },
  });
  await notifyReviewers({
    title: `${c.displayName} sent more information`,
    body: [reply, stored && "They added a new document."].filter(Boolean).join(" ") || "They replied.",
    href: `/admin/consenters/${c.id}`,
  });
  redirect(`/onboarding?replied=1&profile=${c.id}`);
}

/**
 * Mock OAuth connect: marks a channel as proven through the platform. Admins
 * treat that as evidence, so only the profile's owner can do it (as on the
 * owner-only status page that shows the button).
 */
export async function mockOauthConnectAction(formData: FormData) {
  const session = await requireUser();
  const accountId = String(formData.get("accountId") ?? "");
  const account = accountId ? await db.socialAccount.findUnique({ where: { id: accountId } }) : null;
  if (!account?.consenterId) redirect("/onboarding");
  const member = await db.consenterMember.findUnique({
    where: { consenterId_userId: { consenterId: account.consenterId, userId: session.userId } },
  });
  if (!member || member.role !== "OWNER") redirect("/onboarding");
  await db.socialAccount.update({
    where: { id: accountId },
    data: { verifiedVia: "oauth", verifiedAt: new Date() },
  });
  redirect(`/onboarding?profile=${account.consenterId}`);
}

// ── Membership ────────────────────────────────────────────────

/**
 * Pays (or renews) the yearly membership for the active profile. Only while
 * the admin has the membership fee switched on; it is free for now.
 */
export async function payMembershipAction() {
  const path = "/r-panel/billing";
  const { member, requester } = await requireRequester();
  if (member.role === "VIEWER") fail(path, "Viewers can't pay. Ask the profile owner.");
  const settings = await getSettings();
  if (!settings.membershipFeeOn) fail(path, "Membership is free for now. There's nothing to pay.");
  if (requester.status !== "APPROVED") fail(path, "You can pay once your ID check is approved.");
  const { checkoutUrl } = await startMembershipCheckout({
    requesterId: requester.id,
    returnTo: "/r-panel/billing?renewed=1",
  });
  redirect(checkoutUrl);
}
