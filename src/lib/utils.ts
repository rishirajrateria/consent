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
    IN_NEGOTIATION: "In negotiation",
    DEAL_AGREED: "Deal agreed",
    CHANGES_REQUESTED: "Question asked",
    APPROVED_IN_PRINCIPLE: "Approved in principle",
    AGREEMENT_MODE_PENDING: "Agreement mode pending",
    LEGAL_AGREEMENT_PENDING: "Legal agreement pending",
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

export function scoreBand(score: number): string {
  if (score >= 800) return "Excellent";
  if (score >= 650) return "Good";
  if (score >= 450) return "Fair";
  return "Poor";
}
