/**
 * ID-check states an admin can still decide on. APPROVED is left out on
 * purpose: a verified profile is live, and sending it back to review goes
 * through Users (with a reason the team is told). DRAFT hasn't been sent.
 */
export const DECIDABLE_PROFILE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "MORE_INFO_NEEDED", "REJECTED"] as const;

export function decidable(status: string): boolean {
  return (DECIDABLE_PROFILE_STATUSES as readonly string[]).includes(status);
}
