/* Meetings between the two sides of a request. Either side can schedule one
   once the request has been sent (the owner can also do it while approving),
   and either side can move or cancel it. Each person gets their own calendar
   invite listing only themselves, so scheduling never shares anyone's email. */

import type { CallMode, RequestStatus } from "@prisma/client";
import { db } from "./db";
import { calendar } from "./providers";
import { notifyConsenterTeam, notifyRequesterTeam } from "./notify";
import { buildIcs, calendarLinks } from "./ics";

export type Side = "consenter" | "requester";

/** A meeting can be arranged while the request is in play or approved; not once it has ended. */
export const MEETING_STATUSES: RequestStatus[] = [
  "SUBMITTED",
  "PENDING",
  "IN_NEGOTIATION",
  "CHANGES_REQUESTED",
  "DEAL_AGREED",
  "APPROVED_IN_PRINCIPLE",
  "AGREEMENT_MODE_PENDING",
  "LEGAL_AGREEMENT_PENDING",
  "APPROVED",
];

export const DURATIONS = [15, 30, 45, 60, 90] as const;
export const MODE_LABEL: Record<CallMode, string> = { VIDEO: "Video call", PHONE: "Phone call", IN_PERSON: "In person" };

export type MeetingInput = {
  /** Local wall-clock date and time as typed, e.g. "2026-10-14" and "15:30". */
  date: string;
  time: string;
  /** IANA zone of the person scheduling, e.g. "Asia/Kolkata". */
  timeZone: string;
  durationMin: number;
  mode: CallMode;
  link?: string | null;
  location?: string | null;
  note?: string | null;
};

/**
 * Read meeting fields posted by <MeetingFields prefix="meeting_" /> (date,
 * time, duration, mode, link, location, note and the browser's time zone).
 */
export function readMeetingInput(formData: FormData, prefix = "meeting_"): MeetingInput {
  const get = (k: string) => String(formData.get(prefix + k) ?? "").trim();
  const mode = get("mode");
  return {
    date: get("date"),
    time: get("time"),
    // No zone means the browser never filled it in; meetingProblem then asks to reload rather than guess UTC.
    timeZone: get("tz"),
    durationMin: Number(get("duration")) || 30,
    mode: mode === "PHONE" || mode === "IN_PERSON" ? mode : "VIDEO",
    link: get("link") || null,
    location: get("location") || null,
    note: get("note") || null,
  };
}

/** Convert a wall-clock time in an IANA zone to the exact instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // How far that zone is from UTC at (about) that moment; repeat once for DST edges.
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t);
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Plain-language problem with the input, or null when it's fine. */
export function meetingProblem(m: MeetingInput, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !/^\d{2}:\d{2}$/.test(m.time)) return "Pick a date and a time.";
  if (!validTimeZone(m.timeZone)) return "Your time zone couldn't be read. Reload the page and try again.";
  if (!DURATIONS.includes(m.durationMin as (typeof DURATIONS)[number])) return "Pick how long the meeting is.";
  const start = zonedToUtc(m.date, m.time, m.timeZone);
  if (start.getTime() < now.getTime() + 10 * 60_000) return "Pick a time at least 10 minutes from now.";
  if (start.getTime() > now.getTime() + 365 * 86400_000) return "Pick a time within the next year.";
  if (m.mode === "IN_PERSON" && !m.location?.trim()) return "Add where you'll meet.";
  if (m.link && m.mode === "VIDEO" && !/^https:\/\/\S+$/i.test(m.link.trim())) return "Video links must start with https://";
  return null;
}

async function sideContact(request: { consenterId: string; requesterId: string }, side: Side) {
  if (side === "consenter") {
    const p = await db.consenterProfile.findUniqueOrThrow({
      where: { id: request.consenterId },
      include: { members: { where: { role: "OWNER" }, include: { user: true }, take: 1 } },
    });
    return { name: p.displayName, email: p.contactEmail ?? p.members[0]?.user.email ?? null };
  }
  const p = await db.requesterProfile.findUniqueOrThrow({
    where: { id: request.requesterId },
    include: { members: { where: { role: "OWNER" }, include: { user: true }, take: 1 } },
  });
  return { name: p.displayName, email: p.contactEmail ?? p.members[0]?.user.email ?? null };
}

/** Who should get a calendar invite: each side's contact, plus whoever scheduled it if that's someone else. */
async function invitees(
  request: { consenterId: string; requesterId: string },
  scheduler: { name: string; email: string; side: Side },
) {
  const [c, r] = await Promise.all([sideContact(request, "consenter"), sideContact(request, "requester")]);
  const list: { name: string; email: string; side: Side }[] = [];
  if (c.email) list.push({ name: c.name, email: c.email, side: "consenter" });
  if (r.email) list.push({ name: r.name, email: r.email, side: "requester" });
  if (!list.some((x) => x.email.toLowerCase() === scheduler.email.toLowerCase())) list.push(scheduler);
  return list;
}

function details(m: { mode: CallMode; link: string | null; location: string | null; note: string | null }, requestUrl: string) {
  const how = m.mode === "IN_PERSON" ? `In person at ${m.location}` : m.link ? `${MODE_LABEL[m.mode]}: ${m.link}` : MODE_LABEL[m.mode];
  return [how, m.note, `Request on Consent: ${requestUrl}`].filter(Boolean).join("\n\n");
}

async function sendInvites(meetingId: string, cancelled: boolean) {
  const m = await db.requestMeeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { createdBy: true, request: { include: { consenter: true, requester: true } } },
  });
  const title = `Consent: ${m.request.consenter.displayName} × ${m.request.requester.displayName} (request #${m.request.number})`;
  const people = await invitees(m.request, { name: m.createdBy.name, email: m.createdBy.email, side: m.createdBySide as Side });
  const refs: string[] = [];
  for (const to of people) {
    const ics = buildIcs({
      uid: `${m.id}@consent.app`,
      sequence: m.sequence,
      start: m.startsAt,
      end: m.endsAt,
      title,
      description: details(m, requestUrl(m.requestId, to.side)),
      location: m.mode === "IN_PERSON" ? m.location ?? undefined : m.link ?? undefined,
      attendee: { name: to.name, email: to.email },
      cancelled,
    });
    const { ref } = await calendar.putEvent({
      uid: m.id,
      to: { name: to.name, email: to.email },
      subject: `${cancelled ? "Cancelled: " : m.sequence > 0 ? "Updated: " : ""}${title}`,
      summary: cancelled ? "This meeting was cancelled." : `${MODE_LABEL[m.mode]} · ${m.startsAt.toISOString()}`,
      ics,
    });
    refs.push(ref);
  }
  await db.requestMeeting.update({ where: { id: m.id }, data: { calendarRef: refs.join(",") } });
  return { title, m };
}

function whenText(start: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(start);
}

/** Schedule a meeting (or move the existing one) and put it in both calendars. */
export async function scheduleMeeting(opts: {
  requestId: string;
  userId: string;
  userName: string;
  side: Side;
  input: MeetingInput;
}) {
  const problem = meetingProblem(opts.input);
  if (problem) throw new MeetingError(problem);
  const request = await db.consentRequest.findUniqueOrThrow({ where: { id: opts.requestId } });
  if (!MEETING_STATUSES.includes(request.status)) throw new MeetingError("This request has ended, so meetings can't be arranged.");
  const startsAt = zonedToUtc(opts.input.date, opts.input.time, opts.input.timeZone);
  const endsAt = new Date(startsAt.getTime() + opts.input.durationMin * 60_000);
  const data = {
    startsAt,
    endsAt,
    timeZone: opts.input.timeZone,
    mode: opts.input.mode,
    link: opts.input.link?.trim() || null,
    location: opts.input.location?.trim() || null,
    note: opts.input.note?.trim() || null,
  };
  // One live meeting per request: scheduling again moves it, so calendars update the same event.
  const existing = await db.requestMeeting.findFirst({
    where: { requestId: opts.requestId, status: "SCHEDULED" },
    orderBy: { createdAt: "desc" },
  });
  const meeting = existing
    ? await db.requestMeeting.update({ where: { id: existing.id }, data: { ...data, sequence: existing.sequence + 1 } })
    : await db.requestMeeting.create({
        data: { ...data, requestId: opts.requestId, createdById: opts.userId, createdBySide: opts.side },
      });
  await sendInvites(meeting.id, false);
  await db.requestEvent.create({
    data: {
      requestId: opts.requestId,
      type: existing ? "meeting_moved" : "meeting_scheduled",
      actorName: opts.userName,
      actorSide: opts.side,
      detail: { startsAt: startsAt.toISOString(), mode: data.mode },
    },
  });
  const notify = opts.side === "consenter" ? notifyRequesterTeam : notifyConsenterTeam;
  await notify(opts.side === "consenter" ? request.requesterId : request.consenterId, {
    title: `${existing ? "Meeting moved" : "Meeting scheduled"} for request #${request.number}`,
    body: `${whenText(startsAt, opts.input.timeZone)} · ${MODE_LABEL[data.mode]}. It's been added to your calendar invites.`,
    href: opts.side === "consenter" ? `/r-panel/requests/${request.id}` : `/c-panel/requests/${request.id}`,
    critical: true,
  });
  return meeting;
}

/** Cancel the live meeting on a request; both calendars get a cancellation. */
export async function cancelMeeting(opts: { meetingId: string; requestId: string; userName: string; side: Side }) {
  const m = await db.requestMeeting.findFirst({ where: { id: opts.meetingId, requestId: opts.requestId, status: "SCHEDULED" } });
  if (!m) throw new MeetingError("That meeting is no longer scheduled.");
  await db.requestMeeting.update({
    where: { id: m.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), sequence: m.sequence + 1 },
  });
  const { m: full } = await sendInvites(m.id, true);
  await db.requestEvent.create({
    data: { requestId: opts.requestId, type: "meeting_cancelled", actorName: opts.userName, actorSide: opts.side },
  });
  const notify = opts.side === "consenter" ? notifyRequesterTeam : notifyConsenterTeam;
  await notify(opts.side === "consenter" ? full.request.requesterId : full.request.consenterId, {
    title: `Meeting cancelled for request #${full.request.number}`,
    body: `${opts.userName} cancelled the meeting on ${whenText(m.startsAt, m.timeZone)}.`,
    href: opts.side === "consenter" ? `/r-panel/requests/${opts.requestId}` : `/c-panel/requests/${opts.requestId}`,
  });
}

/** Each side's own link to the request. */
export function requestUrl(requestId: string, side: Side) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return `${appUrl}/${side === "consenter" ? "c-panel" : "r-panel"}/requests/${requestId}`;
}

/** Add-to-calendar links for the request page, for the viewer's side. */
export function meetingLinks(m: {
  startsAt: Date;
  endsAt: Date;
  mode: CallMode;
  link: string | null;
  location: string | null;
  note: string | null;
  requestId: string;
}, title: string, side: Side) {
  return calendarLinks({
    start: m.startsAt,
    end: m.endsAt,
    title,
    description: details(m, requestUrl(m.requestId, side)),
    location: m.mode === "IN_PERSON" ? m.location ?? undefined : m.link ?? undefined,
  });
}

export class MeetingError extends Error {}
