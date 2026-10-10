// Relative imports: vitest has no "@/" alias, and asking.test.ts loads this file.
import { requesterActive, consentPriceFor } from "../../../lib/payments";
import { fmtMoney } from "../../../lib/utils";

/** A requester profile this person belongs to, as Find needs it. */
export type AskingMembership = {
  requesterId: string;
  role: string;
  requester: {
    displayName: string;
    status: string;
    onboardingFeePaidAt: Date | null;
    subscriptionEndsAt: Date | null;
  };
};

/**
 * Can this person ask someone from Find, and as which profile?
 * - ready: an approved, paid, in-date asking profile with a seat that can send
 * - viewOnly: the only ready profiles give them a view-only seat
 * - lapsed: approved and paid once, but the yearly plan has ended (requesterId
 *   names the one to renew, a seat that can pay first)
 * - unfinished: applied, but not approved or not paid yet (or turned down)
 * - none: no asking profile at all
 */
export type AskingState =
  | { kind: "ready"; requesterId: string; name: string }
  | { kind: "viewOnly"; name: string }
  | { kind: "lapsed"; requesterId: string }
  | { kind: "unfinished" }
  | { kind: "none" };

export function askingState(memberships: AskingMembership[], activeRequesterId?: string | null): AskingState {
  if (memberships.length === 0) return { kind: "none" };
  const live = memberships.filter((m) => requesterActive(m.requester));
  // The profile already in use wins, so Find asks as the one the person picked.
  const canSend = live
    .filter((m) => m.role !== "VIEWER")
    .sort((a, b) => Number(b.requesterId === activeRequesterId) - Number(a.requesterId === activeRequesterId));
  if (canSend.length) return { kind: "ready", requesterId: canSend[0].requesterId, name: canSend[0].requester.displayName };
  if (live.length) return { kind: "viewOnly", name: live[0].requester.displayName };
  const lapsed = memberships
    .filter(
      (m) => m.requester.status === "APPROVED" && !!m.requester.onboardingFeePaidAt && !!m.requester.subscriptionEndsAt,
    )
    // Viewers can't renew, so a seat that can pay comes first.
    .sort((a, b) => Number(a.role === "VIEWER") - Number(b.role === "VIEWER"));
  return lapsed.length ? { kind: "lapsed", requesterId: lapsed[0].requesterId } : { kind: "unfinished" };
}

/**
 * The consent request fee line on a result card, worded like New request:
 * a range when the fee depends on what it's for, and always the platform fee,
 * so no line reads as free.
 */
export function feeLine(
  owner: { consentPrice: string | null; consentPriceCurrency: string },
  priceTiers: { intentCategoryId: string; amount: string }[],
  intentIds: string[],
): { price: string | null; note: string } {
  const prices =
    priceTiers.length && intentIds.length
      ? intentIds.map((id) => Number(consentPriceFor({ consentPrice: owner.consentPrice, priceTiers }, id) ?? 0))
      : [Number(owner.consentPrice ?? 0)];
  const [min, max] = [Math.min(...prices), Math.max(...prices)];
  const money = (n: number) => fmtMoney(n, owner.consentPriceCurrency);
  if (min !== max) return { price: `${money(min)} to ${money(max)}`, note: " · depends on what it's for, plus the platform fee" };
  if (max > 0) return { price: money(max), note: " · plus the platform fee" };
  return { price: null, note: " · plus the platform fee" };
}
