"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { cn } from "@/lib/utils";
import { MAX_COUNTER_OFFERS } from "@/lib/negotiation";
import { acceptOfferAction, makeOfferAction, closeNegotiationAction } from "@/app/(app)/requests/shared-actions";

type Mode = "accept" | "counter" | "end";

/**
 * Your move in a fee negotiation: accept, counter or end. One choice at a
 * time with its button last, so a typed counter-offer can't be lost by
 * pressing Accept. Each side gets MAX_COUNTER_OFFERS counter-offers.
 */
export function NegotiationActions({
  requestId,
  side,
  latestLabel,
  latestIsTheirs,
  currency,
  showShareContacts,
  myCountersLeft,
  theirCountersLeft,
  otherName,
}: {
  requestId: string;
  side: "consenter" | "requester";
  latestLabel: string;
  latestIsTheirs: boolean;
  currency: string;
  showShareContacts: boolean;
  myCountersLeft: number;
  theirCountersLeft: number;
  otherName: string;
}) {
  const canCounter = myCountersLeft > 0;
  const options: [Mode, string][] = [
    ...(latestIsTheirs ? ([["accept", `Accept ${latestLabel}`]] as [Mode, string][]) : []),
    ...(canCounter ? ([["counter", latestIsTheirs ? "Counter-offer" : "Change my offer"]] as [Mode, string][]) : []),
    ["end", "End this request"],
  ];
  const [mode, setMode] = useState<Mode>(options[0][0]);

  return (
    <div className="space-y-3 border-t hairline pt-3">
      <p className="text-xs text-ink-soft">
        Counter-offers left: <strong>you {myCountersLeft} of {MAX_COUNTER_OFFERS}</strong> · {otherName}{" "}
        {theirCountersLeft} of {MAX_COUNTER_OFFERS}.{" "}
        {canCounter
          ? "After that, the latest offer can only be accepted, or the request ended."
          : "You've used all yours. Accept the latest offer or end this request. To keep negotiating, a new request needs to be raised."}
      </p>
      {!latestIsTheirs && (
        <p className="text-sm text-ink-soft">Waiting for {otherName} to answer your offer of {latestLabel}.</p>
      )}
      <div role="radiogroup" aria-label="Your move" className="flex flex-wrap gap-2">
        {options.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10",
              mode === m ? "glass-ink" : "border border-ink/10 bg-white/60 text-ink-soft hover:bg-white hover:text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "accept" && latestIsTheirs && (
        <form action={acceptOfferAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          {showShareContacts && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="shareContacts" defaultChecked className="size-4 accent-black" />
              Share my contact details so they can pay me directly
            </label>
          )}
          <p className="text-xs text-ink-faint">The fee is paid directly between you, never through Consent.</p>
          <SubmitButton className="w-full sm:w-auto">Accept {latestLabel}</SubmitButton>
        </form>
      )}

      {mode === "counter" && canCounter && (
        <form action={makeOfferAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          <div className="grid gap-3 sm:grid-cols-[8rem_6rem_1fr]">
            <Field label="Amount" required>
              <Input name="amount" type="number" step="0.01" min="0" required placeholder="500" />
            </Field>
            <Field label="Currency" required>
              <Input name="currency" defaultValue={currency} maxLength={3} required />
            </Field>
            <Field label="Note (optional)">
              <Input name="scopeNote" placeholder="e.g. Includes a 3-month window" />
            </Field>
          </div>
          <p className="text-xs text-ink-faint">
            This uses 1 of your {myCountersLeft} remaining counter-offer{myCountersLeft === 1 ? "" : "s"}.
          </p>
          <SubmitButton className="w-full sm:w-auto">{latestIsTheirs ? "Send counter-offer" : "Send new offer"}</SubmitButton>
        </form>
      )}

      {mode === "end" && (
        <form action={closeNegotiationAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          <p className="text-sm text-ink-soft">
            {side === "requester"
              ? "This closes the request without a deal. The fee you paid to ask isn't refunded. You can raise a new request any time."
              : `This closes the request without a deal. ${otherName} can raise a new request if they want to try again.`}
          </p>
          <ConfirmSubmit confirm="End this request without a deal?" variant="danger" className="w-full sm:w-auto">
            End this request
          </ConfirmSubmit>
        </form>
      )}
    </div>
  );
}
