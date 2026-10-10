/* The consent request fee split as percentages for public copy ("80%", "20%"),
   read from the escrow shares so the wording can't drift from the money. */

import { OWNER_SHARE, REFUND_SHARE } from "@/lib/escrow";

const pct = (share: number) => `${Math.round(share * 100)}%`;
/** What the owner gets on a yes, e.g. "80%". */
export const OWNER_PCT = pct(OWNER_SHARE);
/** What is refunded to the requester without a yes, e.g. "80%". */
export const REFUND_PCT = pct(REFUND_SHARE);
/** What Consent keeps either way, e.g. "20%". */
export const CONSENT_PCT = pct(1 - OWNER_SHARE);
