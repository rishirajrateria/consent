/* Fee negotiation rules. The first offer on a request opens the negotiation;
   every offer after it is a counter-offer. Each side gets at most
   MAX_COUNTER_OFFERS counter-offers per request. After that a side can only
   accept the other side's latest offer or end the request; to keep
   negotiating, a new request has to be raised. */

export const MAX_COUNTER_OFFERS = 3;

export type Side = "consenter" | "requester";
type OfferLike = { version: number; bySide: string };

/** How many counter-offers this side has already sent on the request. */
export function countersUsed(offers: OfferLike[], side: Side): number {
  const sorted = [...offers].sort((a, b) => a.version - b.version);
  return sorted.slice(1).filter((o) => o.bySide === side).length;
}

/** How many counter-offers this side can still send (the opening offer never counts). */
export function countersLeft(offers: OfferLike[], side: Side): number {
  return Math.max(0, MAX_COUNTER_OFFERS - countersUsed(offers, side));
}

/** Whether this side may send another offer right now. */
export function canSendOffer(offers: OfferLike[], side: Side): boolean {
  return offers.length === 0 || countersLeft(offers, side) > 0;
}

export const COUNTERS_USED_UP =
  "You've used all 3 of your counter-offers. Accept the latest offer or end this request. To keep negotiating, a new request needs to be raised.";
