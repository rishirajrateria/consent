import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "profile"
  );
}

export function normalizeLegalName(input: string): string {
  return input.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

export function shortId(len = 10): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtMoney(amount: number | string | null | undefined, currency = "USD"): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = {
    DRAFT: "Draft",
    SUBMITTED: "Submitted",
    UNDER_REVIEW: "Under review",
    MORE_INFO_NEEDED: "More info needed",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    PENDING: "Pending",
    CHANGES_REQUESTED: "Question asked",
    // A yes that waits for the final content file the certificate is bound to.
    APPROVED_IN_PRINCIPLE: "Approved, final file needed",
    DENIED: "Denied",
    CLOSED: "Closed",
    EXPIRED_NO_RESPONSE: "Expired (no response)",
    WITHDRAWN: "Withdrawn",
    ACTIVE: "Active",
    EXPIRED: "Expired",
    REVOKED: "Revoked",
    OPEN: "Open",
    UPHELD: "Upheld",
    DISMISSED: "Dismissed",
    RAISED: "Raised",
    MARKED_DOWN: "Marked taken down",
    DECLINED: "Declined",
    CONFIRMED: "Takedown confirmed",
    REJECTED_CLAIM: "Claim rejected",
    IGNORED: "Ignored",
    PAID: "Paid",
    FORFEITED: "Forfeited",
    REFUNDED: "Refunded",
    HELD: "Held",
  };
  return map[s] ?? titleCase(s);
}

/** Plain titles for request timeline events (RequestEvent.type). */
const EVENT_LABELS: Record<string, string> = {
  submitted: "Sent",
  routed: "Routed to a team member",
  auto_approved: "Approved automatically",
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  auto_denied: "Declined automatically",
  denied: "Declined",
  changes_requested: "Question asked",
  ask_answered: "Question answered",
  file_uploaded: "File uploaded",
  grant_issued: "Certificate issued",
  grant_revoked: "Consent revoked",
  withdrawn: "Withdrawn",
  auto_expired: "Expired unanswered",
  auto_closed: "Closed after no action",
  closed: "Closed",
  closed_by_consent: "Closed by Consent",
  admin_force_expired: "Expired by Consent",
  admin_note: "Note from Consent",
  consent_fee_refunded: "Consent request fee refunded",
  consent_price_refunded: "Consent request fee refunded",
  report_filed: "Report filed",
  report_response: "Report answered",
  takedown_raised: "Takedown requested",
  takedown_marked_down: "Marked taken down",
  takedown_declined: "Takedown declined",
  takedown_confirmed: "Takedown confirmed",
  takedown_claim_rejected: "Takedown claim rejected",
  takedown_ignored: "Takedown ignored",
};

/**
 * Event types left by features that no longer exist (fees set between the two
 * sides, paperwork, sharing contact details, meetings). Old timelines skip them.
 */
export const RETIRED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "offer_made",
  "marked_paid",
  "deal_agreed",
  "agreement_mode_chosen",
  "legal_agreement_proposed",
  "legal_agreement_accepted",
  "legal_agreement_declined",
  "agreement_drafted",
  "agreement_signed",
  "agreement_uploaded",
  "agreement_upload_confirmed",
  "agreement_upload_rejected",
  "agreement_redraft_requested",
  "contacts_shared",
  "meeting_scheduled",
  "meeting_moved",
  "meeting_cancelled",
]);

/** Whether a timeline event is still shown (retired kinds are skipped). */
export function shownEvent(e: { type: string }): boolean {
  return !RETIRED_EVENT_TYPES.has(e.type);
}

/** A timeline event's title. */
export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? titleCase(type);
}

export function scoreBand(score: number): string {
  if (score >= 800) return "Excellent";
  if (score >= 650) return "Good";
  if (score >= 450) return "Fair";
  return "Poor";
}
