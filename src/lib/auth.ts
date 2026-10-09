import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { db } from "./db";
import { redirect } from "next/navigation";

const SESSION_COOKIE = "consent_session";
const SESSION_DAYS = 30;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, totpPassed: boolean) {
  const token = randomBytes(32).toString("hex");
  const h = await headers();
  await db.session.create({
    data: {
      id: hashToken(token),
      userId,
      totpPassed,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
      ip: h.get("x-forwarded-for") ?? undefined,
      userAgent: h.get("user-agent")?.slice(0, 255) ?? undefined,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86400,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { id: hashToken(token) } });
    jar.delete(SESSION_COOKIE);
  }
}

export type SessionInfo = NonNullable<Awaited<ReturnType<typeof readSession>>>;

async function readSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { adminRole: true } } },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.isBanned) return null;
  return session;
}

/** Current session + user; null if not logged in. Cached per request. */
export const getSession = cache(readSession);

/** User requiring completed 2FA if enabled. Redirects if absent. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.totpEnabled && !session.totpPassed) redirect("/2fa");
  return session;
}

export async function requireAdmin(module?: string, perm?: string) {
  const session = await requireUser();
  const role = session.user.adminRole;
  if (!role) redirect("/dashboard");
  if (!session.user.totpEnabled) redirect("/settings/security?admin2fa=1");
  if (module && perm && !role.isSuperAdmin) {
    const perms = (role.permissions as Record<string, string[]>) ?? {};
    if (!perms[module]?.includes(perm)) redirect("/admin?denied=1");
  }
  return session;
}

export function hasAdminPerm(
  role: { isSuperAdmin: boolean; permissions: unknown } | null | undefined,
  module: string,
  perm: string
): boolean {
  if (!role) return false;
  if (role.isSuperAdmin) return true;
  const perms = (role.permissions as Record<string, string[]>) ?? {};
  return perms[module]?.includes(perm) ?? false;
}

// ── Active profile context ─────────────────────────────────────

export type ProfileContext =
  | { kind: "consenter"; id: string }
  | { kind: "requester"; id: string }
  | null;

export function parseProfileContext(s: string | null): ProfileContext {
  if (!s) return null;
  const [kind, id] = s.split(":");
  if ((kind === "consenter" || kind === "requester") && id) return { kind, id };
  return null;
}

export async function setActiveProfile(ctx: ProfileContext) {
  const session = await getSession();
  if (!session) return;
  await db.session.update({
    where: { id: session.id },
    data: { activeProfile: ctx ? `${ctx.kind}:${ctx.id}` : null },
  });
}

/** Resolve active consenter membership for the current session, or redirect. */
export async function requireConsenter(minPerm?: "canApprove" | "canNegotiate" | "canEditRules" | "canExport" | "canManageTeam") {
  const session = await requireUser();
  const ctx = parseProfileContext(session.activeProfile);
  let member =
    ctx?.kind === "consenter"
      ? await db.consenterMember.findUnique({
          where: { consenterId_userId: { consenterId: ctx.id, userId: session.userId } },
          include: { consenter: true },
        })
      : null;
  if (!member) {
    member = await db.consenterMember.findFirst({
      where: { userId: session.userId },
      include: { consenter: true },
    });
    if (member) await setActiveProfile({ kind: "consenter", id: member.consenterId });
  }
  if (!member) redirect("/dashboard");
  // 2FA is mandatory for consenter owners and team members
  if (!session.user.totpEnabled) redirect("/settings/security?admin2fa=1");
  if (minPerm && member.role !== "OWNER" && !member[minPerm]) redirect("/c-panel?denied=1");
  return { session, member, consenter: member.consenter };
}

export async function requireRequester() {
  const session = await requireUser();
  const ctx = parseProfileContext(session.activeProfile);
  let member =
    ctx?.kind === "requester"
      ? await db.requesterMember.findUnique({
          where: { requesterId_userId: { requesterId: ctx.id, userId: session.userId } },
          include: { requester: true },
        })
      : null;
  if (!member) {
    member = await db.requesterMember.findFirst({
      where: { userId: session.userId },
      include: { requester: true },
    });
    if (member) await setActiveProfile({ kind: "requester", id: member.requesterId });
  }
  if (!member) redirect("/dashboard");
  return { session, member, requester: member.requester };
}

// ── OTP ────────────────────────────────────────────────────────

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function issueOtp(
  userId: string,
  purpose: "EMAIL_VERIFY" | "PHONE_VERIFY" | "LOGIN" | "SIGNATURE",
  target: string
): Promise<string> {
  const code = generateOtpCode();
  await db.otpCode.create({
    data: { userId, purpose, target, code, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return code;
}

export async function consumeOtp(
  userId: string,
  purpose: "EMAIL_VERIFY" | "PHONE_VERIFY" | "LOGIN" | "SIGNATURE",
  code: string
): Promise<boolean> {
  const row = await db.otpCode.findFirst({
    where: { userId, purpose, code, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) return false;
  await db.otpCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}

// ── TOTP ───────────────────────────────────────────────────────

export function newTotpSecret(): string {
  return authenticator.generateSecret();
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, "Consent", secret);
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    return authenticator.verify({ secret, token });
  } catch {
    return false;
  }
}
