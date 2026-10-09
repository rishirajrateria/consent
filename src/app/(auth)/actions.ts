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

function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

const signupSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().toLowerCase(),
  phone: z.string().min(7).max(20).regex(/^[+\d][\d\s-]+$/, "Invalid phone number"),
  password: z.string().min(8).max(100),
});

export async function signupAction(formData: FormData) {
  if (!rateLimit("signup", await clientIp(), 5, 60 * 60_000))
    fail("/signup", "Too many signups from this address — try again later");
  const parsed = signupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/signup", parsed.error.issues[0]?.message ?? "Invalid input");
  const { name, email, phone, password } = parsed.data;

  const existing = await db.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) fail("/signup", "An account with this email or phone already exists");

  const user = await db.user.create({
    data: { name, email, phone, passwordHash: await hashPassword(password) },
  });
  const code = await issueOtp(user.id, "EMAIL_VERIFY", email);
  const msg = await renderMessage("otp_email", { subject: "Verify your email — Consent", body: "Your verification code is {{code}}. It expires in 10 minutes." }, { code, name });
  await emailProvider.send(email, msg.subject!, msg.body);
  await audit({ actorId: user.id, actorName: name, action: "signup", module: "auth" });
  await createSession(user.id, true);
  redirect("/verify-email");
}

export async function verifyEmailAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const code = String(formData.get("code") ?? "").trim();
  if (!(await consumeOtp(session.userId, "EMAIL_VERIFY", code)))
    fail("/verify-email", "Invalid or expired code");
  await db.user.update({ where: { id: session.userId }, data: { emailVerified: new Date() } });
  redirect("/verify-phone");
}

export async function resendEmailOtpAction() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!rateLimit("otp", session.userId, 5, 15 * 60_000))
    fail("/verify-email", "Too many codes requested — wait a few minutes");
  const code = await issueOtp(session.userId, "EMAIL_VERIFY", session.user.email);
  const msg = await renderMessage("otp_email", { subject: "Verify your email — Consent", body: "Your verification code is {{code}}. It expires in 10 minutes." }, { code, name: session.user.name });
  await emailProvider.send(session.user.email, msg.subject!, msg.body);
  redirect("/verify-email?sent=1");
}

export async function sendPhoneOtpAction() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.user.phone) redirect("/dashboard");
  if (!rateLimit("otp", session.userId, 5, 15 * 60_000))
    fail("/verify-phone", "Too many codes requested — wait a few minutes");
  const code = await issueOtp(session.userId, "PHONE_VERIFY", session.user.phone);
  const msg = await renderMessage("otp_sms", { body: "Consent verification code: {{code}}" }, { code });
  await smsProvider.send(session.user.phone, msg.body);
  redirect("/verify-phone?sent=1");
}

export async function verifyPhoneAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  const code = String(formData.get("code") ?? "").trim();
  if (!(await consumeOtp(session.userId, "PHONE_VERIFY", code)))
    fail("/verify-phone", "Invalid or expired code");
  await db.user.update({ where: { id: session.userId }, data: { phoneVerified: new Date() } });
  redirect("/dashboard");
}

export async function skipPhoneAction() {
  redirect("/dashboard");
}

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) fail("/login", "Enter a valid email and password");
  if (
    !rateLimit("login-ip", await clientIp(), 20, 15 * 60_000) ||
    !rateLimit("login-email", parsed.data.email, 10, 15 * 60_000)
  )
    fail("/login", "Too many attempts — wait a few minutes and try again");
  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash)))
    fail("/login", "Incorrect email or password");
  if (user.isBanned) fail("/login", "This account is banned");
  if (user.isSuspended) fail("/login", "This account is suspended — contact support");
  await createSession(user.id, !user.totpEnabled);
  await audit({ actorId: user.id, actorName: user.name, action: "login", module: "auth" });
  if (user.totpEnabled) redirect("/2fa");
  redirect("/dashboard");
}

export async function totpAction(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!rateLimit("totp", session.userId, 10, 15 * 60_000))
    fail("/2fa", "Too many attempts — wait a few minutes");
  const code = String(formData.get("code") ?? "").trim();
  if (!session.user.totpSecret || !verifyTotp(session.user.totpSecret, code))
    fail("/2fa", "Invalid authenticator code");
  await db.session.update({ where: { id: session.id }, data: { totpPassed: true } });
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
