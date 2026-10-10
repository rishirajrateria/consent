/* One kind of profile. Every profile can both receive requests and send
   them. In the database a profile is a pair: the ConsenterProfile (its
   public page, terms, fee, matrix, earnings; the canonical id) and its
   sending half, a RequesterProfile linked by consenterId. The two are
   created together and kept in step (name, country, verification), and the
   team is mirrored in both member tables. Code that receives uses the
   consenter half, code that sends uses the requester half, and nobody ever
   has to pick a "side".

   Older rows may still be unpaired: the missing half is created here the
   first time it is needed (ensureAsker / ensureProfileFor). */

import type { ConsenterMember, ConsenterProfile, Prisma, RequesterProfile } from "@prisma/client";
import { db } from "./db";
import { normalizeLegalName } from "./utils";
import { entityTypeFor, profileRole, requesterTypeFor, senderRole } from "./profiles-pure";

export { entityTypeFor, profileRole, requesterTypeFor, senderRole };

type Tx = Prisma.TransactionClient;

/** Fields both halves share, from the profile (consenter half). */
export function sharedFields(c: Pick<ConsenterProfile, "displayName" | "legalName" | "country" | "status" | "verifiedAt">) {
  return {
    displayName: c.displayName,
    legalName: c.legalName,
    country: c.country,
    status: c.status,
    approvedAt: c.verifiedAt,
  };
}

async function freeSlug(tx: Tx, base: string, table: "consenter" | "requester") {
  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const taken =
      table === "consenter"
        ? await tx.consenterProfile.findUnique({ where: { slug }, select: { id: true } })
        : await tx.requesterProfile.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Copy the shared fields from the profile to its sending half. Call after any change to them. */
export async function syncPair(consenterId: string, tx: Tx = db) {
  const c = await tx.consenterProfile.findUnique({ where: { id: consenterId } });
  if (!c) return;
  await tx.requesterProfile.updateMany({ where: { consenterId }, data: sharedFields(c) });
}

/** Mirror one profile member onto the sending half (add or update). */
export async function mirrorMember(
  m: Pick<ConsenterMember, "consenterId" | "userId" | "role">,
  tx: Tx = db,
) {
  const asker = await tx.requesterProfile.findUnique({ where: { consenterId: m.consenterId }, select: { id: true } });
  if (!asker) return;
  await tx.requesterMember.upsert({
    where: { requesterId_userId: { requesterId: asker.id, userId: m.userId } },
    update: { role: senderRole(m.role) },
    create: { requesterId: asker.id, userId: m.userId, role: senderRole(m.role) },
  });
}

/** Remove a member from both halves. */
export async function removeMember(consenterId: string, userId: string, tx: Tx = db) {
  const asker = await tx.requesterProfile.findUnique({ where: { consenterId }, select: { id: true } });
  await tx.consenterMember.deleteMany({ where: { consenterId, userId } });
  if (asker) await tx.requesterMember.deleteMany({ where: { requesterId: asker.id, userId } });
}

/** The profile's sending half, created (with the team mirrored) if it is missing. */
export async function ensureAsker(consenterId: string): Promise<RequesterProfile> {
  const existing = await db.requesterProfile.findUnique({ where: { consenterId } });
  if (existing) return existing;
  return db.$transaction(async (tx) => {
    const again = await tx.requesterProfile.findUnique({ where: { consenterId } });
    if (again) return again;
    const c = await tx.consenterProfile.findUniqueOrThrow({
      where: { id: consenterId },
      include: { members: true },
    });
    const asker = await tx.requesterProfile.create({
      data: {
        consenterId,
        slug: await freeSlug(tx, c.slug, "requester"),
        type: requesterTypeFor(c.entityType),
        description: c.bio,
        categories: c.category ? [c.category] : [],
        ...sharedFields(c),
        members: { create: c.members.map((m) => ({ userId: m.userId, role: senderRole(m.role) })) },
      },
    });
    return asker;
  });
}

/**
 * The profile an old sending-only profile belongs to: its receiving half is
 * created (same name, same verification) if it is missing. Returns the
 * profile (consenter) id.
 */
export async function ensureProfileFor(requesterId: string): Promise<string> {
  const r = await db.requesterProfile.findUniqueOrThrow({ where: { id: requesterId }, include: { members: true } });
  if (r.consenterId) return r.consenterId;
  return db.$transaction(async (tx) => {
    const again = await tx.requesterProfile.findUniqueOrThrow({ where: { id: requesterId } });
    if (again.consenterId) return again.consenterId;
    const c = await tx.consenterProfile.create({
      data: {
        slug: await freeSlug(tx, r.slug, "consenter"),
        displayName: r.displayName,
        legalName: r.legalName,
        normalizedLegalName: normalizeLegalName(r.legalName),
        entityType: entityTypeFor(r.type),
        bio: r.description,
        country: r.country,
        category: r.categories[0] ?? null,
        status: r.status,
        verifiedAt: r.approvedAt,
        members: {
          create: r.members.map((m) =>
            m.role === "OWNER"
              ? { userId: m.userId, role: "OWNER" as const, canApprove: true, canEditRules: true, canExport: true, canManageTeam: true }
              : { userId: m.userId, role: profileRole(m.role) },
          ),
        },
      },
    });
    await tx.requesterProfile.update({ where: { id: requesterId }, data: { consenterId: c.id } });
    return c.id;
  });
}

/**
 * The profiles this person belongs to (profile = consenter id), in the
 * order they joined them. Old sending-only memberships are paired first.
 */
export async function profilesOf(userId: string) {
  const loose = await db.requesterMember.findMany({
    where: { userId, requester: { consenterId: null } },
    select: { requesterId: true },
  });
  for (const m of loose) await ensureProfileFor(m.requesterId);
  return db.consenterMember.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { consenter: { include: { asker: true } } },
  });
}

/** True when this request would be a profile asking itself. */
export function isSelfAsk(consenterId: string, requester: Pick<RequesterProfile, "consenterId">) {
  return requester.consenterId === consenterId;
}
