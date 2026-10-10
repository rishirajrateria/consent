import { PrismaClient } from "@prisma/client";

/**
 * Direct Prisma access to the dedicated e2e database. Email/SMS are mocked
 * into OutboxMessage and OTP codes are mirrored in OtpCode, so tests read
 * codes straight from here instead of an inbox.
 */
export const db = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.E2E_DATABASE_URL ??
        "postgresql://consent:consent@localhost:5432/consent_e2e",
    },
  },
});

type OtpPurpose = "EMAIL_VERIFY" | "PHONE_VERIFY" | "LOGIN";

/** Latest unused OTP code issued to the user with this email. */
export async function latestOtp(email: string, purpose: OtpPurpose): Promise<string> {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}`);
  const row = await db.otpCode.findFirst({
    where: { userId: user.id, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new Error(`No unused ${purpose} OTP for ${email}`);
  return row.code;
}

/**
 * A profile by its slug: the canonical half (public page, terms, fee,
 * earnings, the Consent Score for answering).
 */
export async function consenterBySlug(slug: string) {
  const c = await db.consenterProfile.findUnique({ where: { slug } });
  if (!c) throw new Error(`No profile with slug ${slug}`);
  return c;
}

/**
 * The sending half of a profile (the one that asks and pays). It carries the
 * same slug as its profile.
 */
export async function requesterBySlug(slug: string) {
  const r = await db.requesterProfile.findUnique({ where: { slug } });
  if (!r) throw new Error(`No sending profile with slug ${slug}`);
  return r;
}

export async function grantForRequest(requestId: string) {
  return db.grant.findUnique({ where: { requestId } });
}

export async function requestStatus(requestId: string) {
  return (await db.consentRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true } })).status;
}

/**
 * Deletes requests a spec made (with their files, payments, earnings and
 * grant), so a retried spec starts from the same state. Events cascade.
 */
export async function deleteRequests(where: { requesterId?: string; consenterId?: string; ids?: string[] }) {
  const requests = await db.consentRequest.findMany({
    where: {
      ...(where.requesterId ? { requesterId: where.requesterId } : {}),
      ...(where.consenterId ? { consenterId: where.consenterId } : {}),
      ...(where.ids ? { id: { in: where.ids } } : {}),
    },
    select: { id: true },
  });
  const ids = requests.map((r) => r.id);
  if (ids.length === 0) return;
  const grants = await db.grant.findMany({ where: { requestId: { in: ids } }, select: { id: true } });
  const grantIds = grants.map((g) => g.id);
  if (grantIds.length) {
    await db.takedownRequest.deleteMany({ where: { grantId: { in: grantIds } } });
    await db.grant.deleteMany({ where: { id: { in: grantIds } } });
  }
  await db.report.deleteMany({ where: { requestId: { in: ids } } });
  await db.earningEntry.deleteMany({ where: { requestId: { in: ids } } });
  await db.payment.deleteMany({ where: { requestId: { in: ids } } });
  await db.storedFile.deleteMany({ where: { requestId: { in: ids } } });
  await db.consentRequest.deleteMany({ where: { id: { in: ids } } });
}
