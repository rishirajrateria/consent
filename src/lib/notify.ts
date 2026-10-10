import { db } from "./db";
import { email, sms } from "./providers";

/**
 * Notify a single user: in-app notification always; email for state changes
 * and SMS for critical events according to their preferences.
 */
export async function notifyUser(opts: {
  userId: string;
  title: string;
  body: string;
  href?: string;
  critical?: boolean;
}) {
  const user = await db.user.findUnique({
    where: { id: opts.userId },
    include: { notifPrefs: true },
  });
  if (!user) return;
  await db.notification.create({
    data: { userId: user.id, title: opts.title, body: opts.body, href: opts.href },
  });
  const prefs = user.notifPrefs;
  if (prefs?.emailStateChanges ?? true) {
    await email.send(user.email, `[Consent] ${opts.title}`, `${opts.body}\n\n${opts.href ? `Open: ${process.env.APP_URL ?? ""}${opts.href}` : ""}`);
  }
  if (opts.critical && user.phone && (prefs?.smsCritical ?? true)) {
    await sms.send(user.phone, `Consent: ${opts.title} — ${opts.body.slice(0, 120)}`);
  }
}

/** Notify every member of a consenter team (optionally only those with a permission). */
export async function notifyConsenterTeam(
  consenterId: string,
  n: { title: string; body: string; href?: string; critical?: boolean }
) {
  const members = await db.consenterMember.findMany({ where: { consenterId } });
  await Promise.all(members.map((m) => notifyUser({ userId: m.userId, ...n })));
}

export async function notifyRequesterTeam(
  requesterId: string,
  n: { title: string; body: string; href?: string; critical?: boolean }
) {
  const members = await db.requesterMember.findMany({ where: { requesterId } });
  await Promise.all(members.map((m) => notifyUser({ userId: m.userId, ...n })));
}

type Notice = { title: string; body: string; href?: string; critical?: boolean };

/** Notify one side's whole team on a request; each side gets its own link to the request. */
export async function notifySide(
  side: "consenter" | "requester",
  request: { id: string; consenterId: string; requesterId: string },
  n: Omit<Notice, "href">,
) {
  return side === "consenter"
    ? notifyConsenterTeam(request.consenterId, { ...n, href: `/c-panel/requests/${request.id}` })
    : notifyRequesterTeam(request.requesterId, { ...n, href: `/r-panel/requests/${request.id}` });
}
