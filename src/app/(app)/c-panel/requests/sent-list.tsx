import type { ReactNode } from "react";
import type { RequestStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { openSentRequestAction } from "./sent-actions";
import type { Step } from "./sent-step";

/**
 * Opens a request this person made, in the requester workspace. It always
 * goes through openSentRequestAction: the action switches to the profile the
 * request was sent from, then redirects, so the whole page (requester nav and
 * profile switcher included) renders for that profile. A plain link would keep
 * the owner nav on screen while the active profile had already changed.
 */
export function SentLink({
  request,
  label,
  className,
  children,
}: {
  request: { id: string; status: RequestStatus };
  label: string;
  className?: string;
  children: ReactNode;
}) {
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
