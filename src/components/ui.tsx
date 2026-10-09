import Link from "next/link";
import { cn, statusLabel, scoreBand } from "@/lib/utils";
import {
  Check,
  X,
  Clock,
  Ban,
  CircleDashed,
  ShieldCheck,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

// ── Buttons ───────────────────────────────────────────────────

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10 disabled:opacity-40 disabled:pointer-events-none active:scale-[0.98] cursor-pointer";

const btnVariants = {
  primary: "glass-ink hover:opacity-85 px-4 py-2.5",
  secondary:
    "bg-white/70 backdrop-blur-md border border-ink/10 text-ink hover:border-ink/30 hover:bg-white px-4 py-2.5",
  ghost: "text-ink-soft hover:text-ink hover:bg-ink/5 px-3 py-2",
  danger:
    "bg-white/70 backdrop-blur-md border border-ink/25 text-ink hover:bg-ink hover:text-white px-4 py-2.5",
  sm: "",
};

export function Button({
  variant = "primary",
  size,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof btnVariants;
  size?: "sm";
}) {
  return (
    <button
      className={cn(btnBase, btnVariants[variant], size === "sm" && "px-3 py-1.5 text-xs rounded-lg", className)}
      {...props}
    />
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size,
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof btnVariants;
  size?: "sm";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(btnBase, btnVariants[variant], size === "sm" && "px-3 py-1.5 text-xs rounded-lg", className)}
    >
      {children}
    </Link>
  );
}

// ── Form primitives ───────────────────────────────────────────

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input-glass", props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn("input-glass min-h-24", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("input-glass", props.className)} />;
}

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-ink">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

// ── Surfaces ──────────────────────────────────────────────────

export function Card({
  className,
  children,
  strong,
}: {
  className?: string;
  children: ReactNode;
  strong?: boolean;
}) {
  return <div className={cn(strong ? "glass-strong" : "glass", "p-5 sm:p-6", className)}>{children}</div>;
}

export function SectionTitle({
  title,
  desc,
  action,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {desc && <p className="mt-0.5 text-sm text-ink-soft">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  desc,
  action,
  kicker,
}: {
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
  kicker?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 fade-up">
      <div className="min-w-0">
        {kicker && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
            {kicker}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {desc && <div className="mt-1 max-w-2xl text-sm text-ink-soft">{desc}</div>}
      </div>
      {action && <div className="flex shrink-0 gap-2">{action}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon = CircleDashed,
  title,
  desc,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-center gap-2 px-6 py-14 text-center">
      <Icon className="size-7 text-ink-faint" strokeWidth={1.5} aria-hidden />
      <div className="text-sm font-medium text-ink">{title}</div>
      {desc && <div className="max-w-sm text-sm text-ink-faint">{desc}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// ── Status badges (monochrome: shape & fill carry meaning) ────
// solid ink = positive/complete · outline = in progress/neutral ·
// dashed = waiting · crossed icon = negative/terminal

type Tone = "solid" | "outline" | "dashed" | "negative" | "warn";

const STATUS_TONE: Record<string, Tone> = {
  APPROVED: "solid",
  ACTIVE: "solid",
  DEAL_AGREED: "solid",
  CONFIRMED: "solid",
  PAID: "solid",
  VERIFIED: "solid",
  COMPLETED: "solid",
  UPHELD: "solid",
  SUBMITTED: "outline",
  UNDER_REVIEW: "outline",
  IN_NEGOTIATION: "outline",
  APPROVED_IN_PRINCIPLE: "outline",
  AGREEMENT_MODE_PENDING: "outline",
  LEGAL_AGREEMENT_PENDING: "outline",
  AWAITING_SIGNATURES: "outline",
  MARKED_DOWN: "outline",
  OPEN: "outline",
  PENDING: "dashed",
  DRAFT: "dashed",
  MORE_INFO_NEEDED: "dashed",
  CHANGES_REQUESTED: "dashed",
  RAISED: "dashed",
  PROPOSED: "dashed",
  DENIED: "negative",
  REJECTED: "negative",
  REVOKED: "negative",
  CLOSED: "negative",
  WITHDRAWN: "negative",
  CANCELLED: "negative",
  DECLINED: "negative",
  DISMISSED: "negative",
  REJECTED_CLAIM: "negative",
  FAILED: "negative",
  EXPIRED: "warn",
  EXPIRED_NO_RESPONSE: "warn",
  IGNORED: "warn",
  FORFEITED: "warn",
};

const toneClasses: Record<Tone, string> = {
  solid: "bg-ink text-white border border-ink",
  outline: "bg-white/60 text-ink border border-ink/35",
  dashed: "bg-transparent text-ink-soft border border-dashed border-ink/30",
  negative: "bg-white/60 text-ink-soft border border-ink/15 line-through decoration-ink/40",
  warn: "bg-ink/5 text-ink-soft border border-ink/15",
};

const toneIcon: Record<Tone, LucideIcon> = {
  solid: Check,
  outline: Clock,
  dashed: CircleDashed,
  negative: X,
  warn: AlertTriangle,
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? "outline";
  const Icon = toneIcon[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-wide whitespace-nowrap",
        toneClasses[tone],
        className
      )}
    >
      <Icon className="size-3" strokeWidth={2.5} aria-hidden />
      <span className={tone === "negative" ? "no-underline" : undefined}>{statusLabel(status)}</span>
    </span>
  );
}

export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white",
        className
      )}
      title="Verified by Consent"
    >
      <ShieldCheck className="size-3" aria-hidden /> Verified
    </span>
  );
}

export function BlockedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-ink/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-soft">
      <Ban className="size-3" aria-hidden /> Blocked
    </span>
  );
}

// ── Consent Score ring (pure monochrome SVG) ──────────────────

export function ScoreRing({
  score,
  size = 64,
  showBand = true,
}: {
  score: number;
  size?: number;
  showBand?: boolean;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 1000));
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Consent Score ${score} of 1000`}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(17,17,17,0.08)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="#111111"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" textAnchor="middle" fontSize="15" fontWeight="600" fill="#111111">
          {score}
        </text>
      </svg>
      {showBand && (
        <div>
          <div className="text-sm font-semibold text-ink">{scoreBand(score)}</div>
          <div className="text-xs text-ink-faint">Consent Score</div>
        </div>
      )}
    </div>
  );
}

// ── Misc ──────────────────────────────────────────────────────

export function KV({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-ink-faint">{k}</span>
      <span className={cn("min-w-0 text-right text-sm text-ink break-words", mono && "font-mono text-xs")}>{v}</span>
    </div>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("border-t hairline", className)} />;
}

export function Alert({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <div
      className={cn(
        "glass-subtle flex items-start gap-2.5 px-4 py-3 text-sm text-ink-soft",
        tone === "warn" && "border-ink/20"
      )}
    >
      {tone === "warn" && <AlertTriangle className="mt-0.5 size-4 shrink-0 text-ink" aria-hidden />}
      <div>{children}</div>
    </div>
  );
}
