/* Request limits an owner can set: how many requests may wait for their
   first answer at once, and how many new requests may arrive in any 24 hours,
   7 days or 30 days. While any limit is reached, new requests are paused. */

import { db } from "./db";

const HOUR = 3600_000;
export const WINDOWS = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR, monthly: 30 * 24 * HOUR } as const;
/** Waiting for the owner's first answer. Answering (yes, a question or no) frees the slot. */
export const UNANSWERED = ["SUBMITTED", "PENDING"] as const;

export type Limits = {
  maxOpenRequests: number | null;
  dailyRequestLimit: number | null;
  weeklyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
};

export type Capacity = {
  paused: boolean;
  /** Why, in plain words, owner-neutral (e.g. "5 new requests in the last 24 hours (the daily limit)"). */
  reasons: string[];
  /** When the earliest time-based limit frees a slot; null if only "answer some first" applies. */
  opensAt: Date | null;
  /** True when only answering waiting requests will reopen it. */
  untilAnswered: boolean;
  open: number;
  counts: { daily: number; weekly: number; monthly: number };
};

/**
 * Pure: given the limits, how many requests are unanswered and when recent
 * requests arrived, decide whether new requests are paused and until when.
 */
export function evaluateCapacity(limits: Limits, open: number, arrivals: Date[], now = new Date()): Capacity {
  const reasons: string[] = [];
  let opensAt: Date | null = null;
  let untilAnswered = false;
  const counts = { daily: 0, weekly: 0, monthly: 0 };
  const rules: [keyof typeof WINDOWS, number | null, string][] = [
    ["daily", limits.dailyRequestLimit, "in the last 24 hours (the daily limit)"],
    ["weekly", limits.weeklyRequestLimit, "in the last 7 days (the weekly limit)"],
    ["monthly", limits.monthlyRequestLimit, "in the last 30 days (the monthly limit)"],
  ];
  for (const [key, limit, label] of rules) {
    const since = now.getTime() - WINDOWS[key];
    const inWindow = arrivals.filter((d) => d.getTime() > since).sort((a, b) => a.getTime() - b.getTime());
    counts[key] = inWindow.length;
    if (limit != null && limit >= 0 && inWindow.length >= limit) {
      reasons.push(`${inWindow.length} new request${inWindow.length === 1 ? "" : "s"} ${label}`);
      // A slot frees when enough of the oldest requests age out of the window.
      const freeing = limit === 0 ? null : inWindow[inWindow.length - limit];
      const at = freeing ? new Date(freeing.getTime() + WINDOWS[key]) : null;
      if (at && (!opensAt || at > opensAt)) opensAt = at;
      if (!at) untilAnswered = true;
    }
  }
  if (limits.maxOpenRequests != null && open >= limits.maxOpenRequests) {
    reasons.push(`${open} request${open === 1 ? "" : "s"} waiting for an answer (the limit is ${limits.maxOpenRequests})`);
    untilAnswered = true;
  }
  return { paused: reasons.length > 0, reasons, opensAt, untilAnswered, open, counts };
}

/** Live capacity for one owner profile. */
export async function requestCapacity(consenterId: string, now = new Date()): Promise<Capacity> {
  const profile = await db.consenterProfile.findUniqueOrThrow({
    where: { id: consenterId },
    select: { maxOpenRequests: true, dailyRequestLimit: true, weeklyRequestLimit: true, monthlyRequestLimit: true },
  });
  const [open, recent] = await Promise.all([
    db.consentRequest.count({ where: { consenterId, status: { in: [...UNANSWERED] } } }),
    db.consentRequest.findMany({
      where: { consenterId, submittedAt: { gt: new Date(now.getTime() - WINDOWS.monthly) } },
      select: { submittedAt: true },
    }),
  ]);
  return evaluateCapacity(profile, open, recent.map((r) => r.submittedAt!), now);
}

/** One plain sentence for a requester about a paused profile. */
export function pausedMessage(name: string, c: Capacity, fmt: (d: Date) => string): string {
  if (!c.paused) return "";
  if (c.untilAnswered && !c.opensAt) return `${name} has paused new requests until they answer the ones waiting.`;
  if (c.untilAnswered && c.opensAt)
    return `${name} has paused new requests until they answer the ones waiting and ${fmt(c.opensAt)} at the earliest.`;
  return `${name} isn't taking new requests right now. It opens again ${fmt(c.opensAt!)}.`;
}
