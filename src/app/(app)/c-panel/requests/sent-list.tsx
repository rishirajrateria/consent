import type { ReactNode } from "react";
import Link from "next/link";
import type { RequestStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { openSentRequestAction } from "./sent-actions";
import { sentHref, type Step } from "./sent-step";

/**
 * Opens a request this person sent. One sent from the active profile is a
 * plain link (`direct`). One sent from another of their profiles goes through
 * openSentRequestAction, which switches to that profile first, so the whole
 * page (header and profile switcher included) shows the profile it was sent
 * from. Either way the row's accessible name is `label`.
 */
export function SentLink({
  request,
  label,
  className,
  direct = false,
  children,
}: {
  request: { id: string; status: RequestStatus };
  label: string;
  className?: string;
  /** Sent from the active profile: open it with a plain link, no switch needed. */
  direct?: boolean;
  children: ReactNode;
}) {
  if (direct) {
    return (
      <Link
        href={sentHref(request)}
        aria-label={label}
        className={cn(
          "group block rounded-[var(--radius-glass)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10",
          className,
        )}
      >
        {children}
      </Link>
    );
  }
  return (
    <form action={openSentRequestAction} className={cn("group relative", className)}>
      <input type="hidden" name="id" value={request.id} />
      {children}
      <button
        type="submit"
        aria-label={label}
        className="absolute inset-0 cursor-pointer rounded-[var(--radius-glass)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10"
      />
    </form>
  );
}

/**
 * The next step on a sent request. "Your move" marks it only when this person
 * can act on it; on a view-only seat an open request says "View only" instead.
 */
export function StepLine({ step, canAct = true, className }: { step: Step; canAct?: boolean; className?: string }) {
  const mine = step.move === "you";
  return (
    <div className={cn("text-xs text-ink-soft", className)}>
      {mine && canAct && (
        <span className="mr-1.5 inline-flex rounded-full bg-ink px-1.5 py-0.5 align-[1px] text-[10px] font-semibold uppercase leading-none tracking-wider text-white">
          Your move
        </span>
      )}
      {!canAct && step.move !== "done" && (
        <span className="mr-1.5 inline-flex rounded-full border border-ink/15 px-1.5 py-0.5 align-[1px] text-[10px] font-semibold uppercase leading-none tracking-wider text-ink-soft">
          View only
        </span>
      )}
      {step.text}
    </div>
  );
}
