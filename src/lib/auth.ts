import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { db } from "./db";
import { redirect } from "next/navigation";
import { ensureAsker, ensureProfileFor, mirrorMember, profilesOf } from "./profiles";

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

/** User requiring completed 2FA if enabled and a verified email. Redirects if absent. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.totpEnabled && !session.totpPassed) redirect("/2fa");
  // Email OTP is mandatory: the account stays locked until the address is proven.
  if (!session.user.emailVerified) redirect("/verify-email");
  return session;
}

/**
 * Where to go after sign-in, signup or verification: a path on this site, or
 * null. Rejects anything that would leave the site ("//host", "/\host", full URLs).
 */
export function safeNext(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith("/") || v.length > 500) return null;
  try {
    const u = new URL(v, "http://local");
    if (u.origin !== "http://local") return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
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
// Every profile can both receive and send (src/lib/profiles.ts). The session
// remembers which profile is active as "consenter:<profile id>". Old values
// ("requester:<id>") are mapped to the profile that sending half belongs to.
// requireConsenter and requireRequester both resolve that same profile: one
// returns its receiving half, the other its sending half.

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

/** Make a profile active. A sending half is stored as the profile it belongs to. */
export async function setActiveProfile(ctx: ProfileContext) {
  const session = await getSession();
  if (!session) return;
  let value: string | null = null;
  if (ctx?.kind === "consenter") value = `consenter:${ctx.id}`;
  if (ctx?.kind === "requester") value = `consenter:${await ensureProfileFor(ctx.id)}`;
  await db.session.update({ where: { id: session.id }, data: { activeProfile: value } });
  // The session is read once per request (cache), so keep that copy in step too.
  session.activeProfile = value;
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * The active profile's membership for this person: the profile in the
 * session if they still belong to it, else their first profile (preferring
 * one they own). Null when they have no profile yet.
 */
async function activeMembership(session: Session) {
  const ctx = parseProfileContext(session.activeProfile);
  let profileId: string | null = null;
  if (ctx?.kind === "consenter") profileId = ctx.id;
  if (ctx?.kind === "requester") {
    const r = await db.requesterProfile.findUnique({ where: { id: ctx.id }, select: { id: true } });
    if (r) profileId = await ensureProfileFor(r.id);
  }
  let member = profileId
    ? await db.consenterMember.findUnique({
        where: { consenterId_userId: { consenterId: profileId, userId: session.userId } },
        include: { consenter: true },
      })
    : null;
  if (!member) {
    const all = await profilesOf(session.userId);
    const first = all.find((m) => m.role === "OWNER") ?? all[0];
    member = first ? { ...first, consenter: first.consenter } : null;
  }
  if (member && session.activeProfile !== `consenter:${member.consenterId}`) {
    await setActiveProfile({ kind: "consenter", id: member.consenterId });
  }
  return member;
}

type ProfilePerm = "canApprove" | "canEditRules" | "canExport" | "canManageTeam";

/**
 * The active profile, for pages that receive requests, set terms or manage
 * the profile. Redirects to onboarding without a profile, and to set up 2FA
 * first (every account answers requests, so every account needs it).
 */
export async function requireConsenter(minPerm?: ProfilePerm) {
  const session = await requireUser();
  const member = await activeMembership(session);
  if (!member) redirect("/onboarding");
  if (!session.user.totpEnabled) redirect("/settings/security?admin2fa=1");
  // Owners can do everything; viewers nothing, whatever their flags say.
  if (minPerm && member.role !== "OWNER" && (member.role === "VIEWER" || !member[minPerm])) redirect("/c-panel?denied=1");
  return { session, member, consenter: member.consenter };
}

/**
 * The active profile's sending half, for pages that send requests. Same
 * profile as requireConsenter; its sending half (and this person's seat on
 * it) is created if missing.
 */
export async function requireRequester() {
  const session = await requireUser();
  const profile = await activeMembership(session);
  if (!profile) redirect("/onboarding");
  if (!session.user.totpEnabled) redirect("/settings/security?admin2fa=1");
  const asker = await ensureAsker(profile.consenterId);
  let member = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: asker.id, userId: session.userId } },
    include: { requester: true },
  });
  if (!member) {
    await mirrorMember(profile);
    member = await db.requesterMember.findUniqueOrThrow({
      where: { requesterId_userId: { requesterId: asker.id, userId: session.userId } },
      include: { requester: true },
    });
  }
  return { session, member, requester: member.requester };
}

// ── OTP ────────────────────────────────────────────────────────

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function issueOtp(
  userId: string,
  purpose: "EMAIL_VERIFY" | "PHONE_VERIFY" | "LOGIN",
  target: string
): Promise<string> {
  const code = generateOtpCode();
  await db.otpCode.create({
    data: { userId, purpose, target, code, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  return code;
}

/** Uses up a live code. With `target`, only a code sent to that address counts. */
export async function consumeOtp(
  userId: string,
  purpose: "EMAIL_VERIFY" | "PHONE_VERIFY" | "LOGIN",
  code: string,
  target?: string
): Promise<boolean> {
  const row = await db.otpCode.findFirst({
    where: { userId, purpose, code, usedAt: null, expiresAt: { gt: new Date() }, ...(target ? { target } : {}) },
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
