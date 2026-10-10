/* Every open request expires a fixed number of days (Admin → settings, 7 by
   default) after its last action. Any action from either side (an answer,
   asking a question, answering it, an upload) starts a fresh window. The last
   action is read from what those actions leave behind, so no action has to
   remember to reset a timer. */

import type { RequestStatus } from "@prisma/client";
import { db } from "./db";

/** Requests that are still in play: sent, and neither certified nor ended. */
export const OPEN_STATUSES: RequestStatus[] = ["SUBMITTED", "PENDING", "CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE"];

export type Side = "consenter" | "requester";

/**
 * Whose move it is on an open request: the person asked ("consenter") while it
 * waits for their answer, the person asking ("requester") while it waits for
 * their reply to a question or for the final file. Null when nobody has a move
 * (a draft, or the request has ended).
 */
export function waitingOn(status: RequestStatus): Side | null {
  switch (status) {
    case "SUBMITTED":
    case "PENDING":
      return "consenter";
    case "CHANGES_REQUESTED":
    case "APPROVED_IN_PRINCIPLE":
      return "requester";
    default:
      return null;
  }
}

/** When a window that started at `last` ends. */
export function windowEnd(last: Date, days: number): Date {
  return new Date(last.getTime() + days * 86400_000);
}

const latest = (...dates: (Date | null | undefined)[]) =>
  dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/**
 * Last action per request: the latest of submission, a person's timeline
 * event, an old message or an upload. System events (reminders, refunds,
 * expiry) don't count.
 */
export async function lastActivity(requests: { id: string; submittedAt: Date | null; createdAt: Date }[]) {
  const ids = requests.map((r) => r.id);
  const out = new Map<string, Date>();
  if (ids.length === 0) return out;
  const [events, messages, files] = await Promise.all([
    db.requestEvent.groupBy({
      by: ["requestId"],
      where: { requestId: { in: ids }, actorSide: { in: ["consenter", "requester", "admin"] } },
      _max: { createdAt: true },
    }),
    db.requestMessage.groupBy({ by: ["requestId"], where: { requestId: { in: ids } }, _max: { createdAt: true } }),
    db.storedFile.groupBy({ by: ["requestId"], where: { requestId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const pick = (rows: { requestId: string | null; _max: { createdAt: Date | null } }[]) =>
    new Map(rows.filter((r) => r.requestId).map((r) => [r.requestId as string, r._max.createdAt]));
  const [e, m, f] = [pick(events), pick(messages), pick(files)];
  for (const r of requests) {
    out.set(r.id, latest(r.submittedAt ?? r.createdAt, e.get(r.id), m.get(r.id), f.get(r.id))!);
  }
  return out;
}

/** The current window for each request: last action and when it expires if nobody acts. */
export async function requestWindows(
  requests: { id: string; submittedAt: Date | null; createdAt: Date }[],
  days: number,
) {
  const last = await lastActivity(requests);
  return new Map([...last].map(([id, at]) => [id, { lastActivityAt: at, expiresAt: windowEnd(at, days) }]));
}
