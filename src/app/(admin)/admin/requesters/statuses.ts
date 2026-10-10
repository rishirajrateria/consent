/**
 * Application states an admin can still decide on. APPROVED is left out on
 * purpose: an approved requester has paid, and re-deciding would lock them out
 * (pausing an account belongs in Users). DRAFT hasn't been sent yet.
 */
export const DECIDABLE_REQUESTER_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_NEEDED", "REJECTED"] as const;
