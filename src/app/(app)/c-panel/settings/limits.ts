/* The owner's request limits as the settings form reads them. Pure, so it
   can be unit-tested without a database. */

import type { Limits } from "@/lib/capacity";

/** Highest limit we take, so a typo can't overflow the database column. */
export const MAX_LIMIT = 10_000;

/** The owner's request limits, in the order the settings form shows them. */
export const LIMIT_FIELDS: { name: keyof Limits; label: string; hint: string }[] = [
  {
    name: "maxOpenRequests",
    label: "Max waiting for your answer",
    hint: "Pause when this many requests are waiting for your answer.",
  },
  { name: "dailyRequestLimit", label: "Per day", hint: "New requests in any 24 hours." },
  { name: "weeklyRequestLimit", label: "Per week", hint: "New requests in any 7 days." },
  { name: "monthlyRequestLimit", label: "Per month", hint: "New requests in any 30 days." },
];

export const LIMITS_ERROR = `Request limits must be whole numbers from 1 to ${MAX_LIMIT.toLocaleString("en-US")}. Leave a box empty for no limit.`;

/**
 * Reads the request limits from the settings form. An empty box means no
 * limit; anything else must be a whole number from 1 to MAX_LIMIT. Returns
 * null when a box holds something else, so nothing is saved.
 */
export function readLimits(formData: FormData): Limits | null {
  const out = {} as Limits;
  for (const { name } of LIMIT_FIELDS) {
    const raw = String(formData.get(name) ?? "").trim();
    if (raw === "") {
      out[name] = null;
      continue;
    }
    // Check the number, not its spelling: a number box may send "10.0" or "1e2".
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return null;
    out[name] = n;
  }
  return out;
}
