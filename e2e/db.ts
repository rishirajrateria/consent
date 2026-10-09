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

type OtpPurpose = "EMAIL_VERIFY" | "PHONE_VERIFY" | "LOGIN" | "SIGNATURE";

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

export async function consenterBySlug(slug: string) {
  const c = await db.consenterProfile.findUnique({ where: { slug } });
  if (!c) throw new Error(`No consenter with slug ${slug}`);
  return c;
}

export async function requesterBySlug(slug: string) {
  const r = await db.requesterProfile.findUnique({ where: { slug } });
  if (!r) throw new Error(`No requester with slug ${slug}`);
  return r;
}

export async function grantForRequest(requestId: string) {
  return db.grant.findUnique({ where: { requestId } });
}
