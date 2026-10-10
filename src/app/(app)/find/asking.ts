// Relative imports: vitest has no "@/" alias, and asking.test.ts loads this file.
import { canSend, verified } from "../../../lib/membership";
import { PLATFORM_PCT } from "../../../lib/platform-fee";
import { fmtMoney } from "../../../lib/utils";

/** A profile this person belongs to, as Find needs it. */
export type AskingMembership = {
  /** The profile's id (its receiving half, the canonical one). */
  profileId: string;
  role: string;
  profile: {
    displayName: string;
    status: string;
    /** From the profile's sending half; null when it never had a membership. */
    membershipEndsAt: Date | null;
  };
};

/**
 * Can this person ask someone from Find, and as which profile? Every
 * verified profile can ask.
 * - ready: a verified profile they can send for (the active one first)
 * - viewOnly: the only profiles that could send give them a view-only seat
 * - membership: verified, but the yearly membership is needed to send (only
 *   while the membership fee is on); profileId names the one to pay for
 * - unverified: their profile's ID check isn't approved yet
 * - none: no profile yet
 */
export type AskingState =
  | { kind: "ready"; profileId: string; name: string }
  | { kind: "viewOnly"; name: string }
  | { kind: "membership"; profileId: string }
  | { kind: "unverified" }
  | { kind: "none" };

export function askingState(
  memberships: AskingMembership[],
  activeProfileId: string | null | undefined,
  membershipFeeOn: boolean,
  now = new Date(),
): AskingState {
  if (memberships.length === 0) return { kind: "none" };
  const live = memberships.filter((m) => canSend(m.profile, membershipFeeOn, now));
  // The active profile wins, so Find asks as the one the person is using.
  const senders = live
    .filter((m) => m.role !== "VIEWER")
    .sort((a, b) => Number(b.profileId === activeProfileId) - Number(a.profileId === activeProfileId));
  if (senders.length) return { kind: "ready", profileId: senders[0].profileId, name: senders[0].profile.displayName };
  // Before "view-only", look at the profiles this person could send for
  // themselves: one they can fix (membership) or one waiting on its ID check.
  const own = memberships
    .filter((m) => m.role !== "VIEWER")
    .sort((a, b) => Number(b.profileId === activeProfileId) - Number(a.profileId === activeProfileId));
  // Verified but unable to send can only mean the membership (canSend).
  const unpaid = own.find((m) => verified(m.profile));
  if (unpaid) return { kind: "membership", profileId: unpaid.profileId };
  if (own.length) return { kind: "unverified" };
  if (live.length) return { kind: "viewOnly", name: live[0].profile.displayName };
  // Only view-only seats, none of which can send: a verified one needs the
  // membership (the owner pays), otherwise the ID check is still pending.
  const viewerVerified = memberships
    .filter((m) => verified(m.profile))
    .sort((a, b) => Number(b.profileId === activeProfileId) - Number(a.profileId === activeProfileId));
  return viewerVerified.length ? { kind: "membership", profileId: viewerVerified[0].profileId } : { kind: "unverified" };
}

/** What a result card says about the cost of asking. */
export type FeeLine = { free: true } | { free: false; price: string; note: string };

/**
 * The consent request fee line on a result card: "Free to ask", or the fee
 * plus the 20% platform fee. When the fee depends on what the request is for
 * (per-use fees), it shows the range.
 */
export function feeLine(
  owner: { consentPrice: string | null; consentPriceCurrency: string },
  priceTiers: { intentCategoryId: string; amount: string }[],
  intentIds: string[],
): FeeLine {
  const paid = (v: string | null | undefined) => (v != null && Number(v) > 0 ? Number(v) : 0);
  // A per-use fee wins over the base fee (same rule as consentPriceFor in payments).
  const feeFor = (intentId: string) => {
    const tier = priceTiers.find((t) => t.intentCategoryId === intentId);
    return paid(tier ? tier.amount : owner.consentPrice);
  };
  const prices = priceTiers.length && intentIds.length ? intentIds.map(feeFor) : [paid(owner.consentPrice)];
  const [min, max] = [Math.min(...prices), Math.max(...prices)];
  if (max === 0) return { free: true };
  const money = (n: number) => fmtMoney(n, owner.consentPriceCurrency);
  const plus = ` + ${PLATFORM_PCT} platform fee`;
  if (min === max) return { free: false, price: money(max), note: plus };
  if (min === 0) return { free: false, price: `up to ${money(max)}`, note: `${plus} · free for some uses` };
  return { free: false, price: `${money(min)} to ${money(max)}`, note: `${plus} · depends on what it's for` };
}
