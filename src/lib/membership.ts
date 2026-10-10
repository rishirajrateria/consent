/* The yearly membership: the same for every account (₹1,000 a year in
   India). It is switched off for now, so every verified profile can send
   requests without paying. When the admin switches it on, a profile needs a
   membership that hasn't ended to send; receiving never needs one.
   Pure: safe to import anywhere. */

type Sender = { status: string; membershipEndsAt: Date | null };

/** The profile is verified (one ID check for everyone). */
export function verified(r: { status: string }) {
  return r.status === "APPROVED";
}

/** The membership counts as paid: the fee is off, or it is paid until a future date. */
export function membershipOk(r: Pick<Sender, "membershipEndsAt">, membershipFeeOn: boolean, now = new Date()) {
  return !membershipFeeOn || (!!r.membershipEndsAt && r.membershipEndsAt > now);
}

/** The profile can send requests: verified, and the membership is fine. */
export function canSend(r: Sender, membershipFeeOn: boolean, now = new Date()) {
  return verified(r) && membershipOk(r, membershipFeeOn, now);
}
