/* The platform fee for sending a request: 20% of the owner's consent request
   fee, paid on top of it. It is the same 20% Consent keeps from the consent
   request fee itself, so both sides give Consent the same share. Asking
   someone whose consent request fee is free costs no platform fee, and the
   request is sent without a checkout. The platform fee is never refunded.
   Pure: safe to import from any page or client component. */

/** Share of the consent request fee charged as the platform fee. */
export const PLATFORM_SHARE = 0.2;
/** "20%", for copy. */
export const PLATFORM_PCT = `${Math.round(PLATFORM_SHARE * 100)}%`;

const cents = (n: number) => Math.round(n * 100) / 100;

const num = (v: { toString(): string } | number | null | undefined) => (v == null ? 0 : Number(v.toString()));

/** The platform fee for a consent request fee: 20% of it, or 0 when asking is free. */
export function platformFeeFor(consentFee: { toString(): string } | number | null | undefined): number {
  const fee = num(consentFee);
  return fee > 0 ? cents(fee * PLATFORM_SHARE) : 0;
}

/**
 * Everything a requester pays to send one request, in the consent request
 * fee's currency. A coupon takes its percentage off the platform fee only,
 * and tax (when the requester's country has one) applies to what is left of
 * the platform fee; the consent request fee itself is never discounted or taxed.
 */
export function requestCharges(
  consentFee: { toString(): string } | number | null | undefined,
  opts: { percentOff?: number | null; taxRate?: { toString(): string } | number | null } = {},
) {
  const consent = cents(Math.max(0, num(consentFee)));
  const platformFee = platformFeeFor(consent);
  const discount = opts.percentOff ? cents((platformFee * opts.percentOff) / 100) : 0;
  const platformAfterDiscount = cents(platformFee - discount);
  const rate = num(opts.taxRate);
  const tax = rate ? cents((platformAfterDiscount * rate) / 100) : 0;
  const platformTotal = cents(platformAfterDiscount + tax);
  return {
    consentFee: consent,
    platformFee,
    discount,
    tax,
    /** The platform fee line as charged: after the coupon, with tax. */
    platformTotal,
    total: cents(consent + platformTotal),
    /** Nothing to pay: the request is sent without a checkout. */
    free: consent === 0,
  };
}
