"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  getSession,
  hashPassword,
  verifyPassword,
  issueOtp,
  consumeOtp,
  verifyTotp,
  safeNext,
} from "@/lib/auth";
import { email as emailProvider, sms as smsProvider } from "@/lib/providers";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { renderMessage } from "@/lib/templates";
import { headers } from "next/headers";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

/** path + query string, skipping empty values. */
function withParams(path: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Back to the form with an error, keeping where the person was headed. */
function fail(path: string, error: string, next?: string | null): never {
  redirect(withParams(path, { error, next }));
}

/** The `next` hidden field, if it points inside the site. */
function nextOf(formData?: FormData): string | null {
  return safeNext(formData?.get("next"));
}

async function sendEmailCode(userId: string, to: string, name: string) {
  const code = await issueOtp(userId, "EMAIL_VERIFY", to);
  const msg = await renderMessage("otp_email", { subject: "Verify your email — Consent", body: "Your verification code is {{code}}. It expires in 10 minutes." }, { code, name });
  await emailProvider.send(to, msg.subject!, msg.body);
}

const signupSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(7).max(20).regex(/^[+\d][\d\s-]+$/, "Invalid phone number"),
  password: z.string().min(8).max(100),
});

export async function signupAction(formData: FormData) {
  const next = nextOf(formData);
  if (!rateLimit("signup", await clientIp(), 5, 60 * 60_000))
    fail("/signup", "Too many signups from this address — try again later", next);
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/signup", parsed.error.issues[0]?.message ?? "Invalid input", next);
  const { name, email, phone, password } = parsed.data;

  const existing = await db.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) fail("/signup", "An account with this email or phone already exists", next);

  const user = await db.user.create({
    data: { name, email, phone, passwordHash: await hashPassword(password) },
  });
  await sendEmailCode(user.id, email, name);
  await audit({ actorId: user.id, actorName: name, action: "signup", module: "auth" });
  await createSession(user.id, true);
  redirect(withParams("/verify-email", { next }));
}

export async function verifyEmailAction(formData: FormData) {
  const next = nextOf(formData);
  const session = await getSession();
  if (!session) redirect(withParams("/login", { next }));
  const code = String(formData.get("code") ?? "").trim();
  // Only a code sent to the current address proves it (not one sent before a correction).
  if (!(await consumeOtp(session.userId, "EMAIL_VERIFY", code, session.user.email)))
    fail("/verify-email", "Invalid or expired code", next);
  await db.user.update({ where: { id: session.userId }, data: { emailVerified: new Date() } });
  redirect(withParams("/verify-phone", { next }));
}

export async function resendEmailOtpAction(formData: FormData) {
  const next = nextOf(formData);
  const session = await getSession();
  if (!session) redirect(withParams("/login", { next }));
  if (!rateLimit("otp", session.userId, 5, 15 * 60_000))
    fail("/verify-email", "Too many codes requested — wait a few minutes", next);
  await sendEmailCode(session.userId, session.user.email, session.user.name);
  redirect(withParams("/verify-email", { sent: "1", next }));
}

/**
 * Fix a mistyped address before it is verified: only while the email is
 * unproven, and only to an address no other account uses. Sends a new code.
 */
export async function changeEmailAction(formData: FormData) {
  const next = nextOf(formData);
  const session = await getSession();
  if (!session) redirect(withParams("/login", { next }));
  if (session.user.emailVerified) redirect(next ?? "/dashboard");
  const parsed = z.string().trim().email().toLowerCase().safeParse(formData.get("email"));
  if (!parsed.success) fail("/verify-email", "Enter a valid email address", next);
  const email = parsed.data;
  if (!rateLimit("otp", session.userId, 5, 15 * 60_000))
    fail("/verify-email", "Too many codes requested — wait a few minutes", next);
  if (email !== session.user.email.toLowerCase()) {
    const taken = await db.user.findUnique({ where: { email } });
    if (taken) fail("/verify-email", "Another account already uses that email", next);
    // Codes sent to the old address must not verify the new one.
    await db.otpCode.updateMany({
      where: { userId: session.userId, purpose: "EMAIL_VERIFY", usedAt: null },
      data: { usedAt: new Date() },
    });
    await db.user.update({ where: { id: session.userId }, data: { email } });
    await audit({
      actorId: session.userId,
      actorName: session.user.name,
      action: "email_corrected_before_verify",
      module: "auth",
      detail: { from: session.user.email, to: email },
    });
  }
  await sendEmailCode(session.userId, email, session.user.name);
  redirect(withParams("/verify-email", { sent: "1", next }));
}

export async function sendPhoneOtpAction(formData: FormData) {
  const next = nextOf(formData);
  const session = await getSession();
  if (!session) redirect(withParams("/login", { next }));
  if (!session.user.phone) redirect(await afterPhone(next));
  if (!rateLimit("otp", session.userId, 5, 15 * 60_000))
    fail("/verify-phone", "Too many codes requested — wait a few minutes", next);
  const code = await issueOtp(session.userId, "PHONE_VERIFY", session.user.phone);
  const msg = await renderMessage("otp_sms", { body: "Consent verification code: {{code}}" }, { code });
  await smsProvider.send(session.user.phone, msg.body);
  redirect(withParams("/verify-phone", { sent: "1", next }));
}

export async function verifyPhoneAction(formData: FormData) {
  const next = nextOf(formData);
  const session = await getSession();
  if (!session) redirect(withParams("/login", { next }));
  const code = String(formData.get("code") ?? "").trim();
  if (!(await consumeOtp(session.userId, "PHONE_VERIFY", code)))
    fail("/verify-phone", "Invalid or expired code", next);
  await db.user.update({ where: { id: session.userId }, data: { phoneVerified: new Date() } });
  redirect(await afterPhone(next));
}

/**
 * Skipping the phone step is only for joining a team from an invite: the ID
 * check (/onboarding) always needs a verified phone.
 */
export async function skipPhoneAction(formData: FormData) {
  const next = nextOf(formData);
  if (!next?.startsWith("/invite/")) fail("/verify-phone", "Verify your phone to continue.", next);
  redirect(await afterPhone(next));
}

/**
 * After the phone step: every account sets up 2FA next, then goes where it
 * was headed (an invite), or on to the one ID check.
 */
async function afterPhone(next: string | null): Promise<string> {
  const session = await getSession();
  if (session && !session.user.totpEnabled)
    return withParams("/settings/security", { next: next ?? "/onboarding" });
  return next ?? "/dashboard";
}

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData) {
  const next = nextOf(formData);
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/login", "Enter a valid email and password", next);
  if (
    !rateLimit("login-ip", await clientIp(), 20, 15 * 60_000) ||
    !rateLimit("login-email", parsed.data.email, 10, 15 * 60_000)
  )
    fail("/login", "Too many attempts — wait a few minutes and try again", next);
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash)))
    fail("/login", "Incorrect email or password", next);
  if (user.isBanned) fail("/login", "This account is banned", next);
  if (user.isSuspended) fail("/login", "This account is suspended — contact support", next);
  await createSession(user.id, !user.totpEnabled);
  await audit({ actorId: user.id, actorName: user.name, action: "login", module: "auth" });
  if (user.totpEnabled) redirect(withParams("/2fa", { next }));
  if (!user.emailVerified) redirect(withParams("/verify-email", { next }));
  redirect(next ?? "/dashboard");
}

export async function totpAction(formData: FormData) {
  const next = nextOf(formData);
  const session = await getSession();
  if (!session) redirect(withParams("/login", { next }));
  if (!rateLimit("totp", session.userId, 10, 15 * 60_000))
    fail("/2fa", "Too many attempts — wait a few minutes", next);
  const code = String(formData.get("code") ?? "").trim();
  if (!session.user.totpSecret || !verifyTotp(session.user.totpSecret, code))
    fail("/2fa", "Invalid authenticator code", next);
  await db.session.update({ where: { id: session.id }, data: { totpPassed: true } });
  if (!session.user.emailVerified) redirect(withParams("/verify-email", { next }));
  redirect(next ?? "/dashboard");
}

export async function logoutAction(formData?: FormData) {
  await destroySession();
  redirect(withParams("/login", { next: nextOf(formData) }));
}
