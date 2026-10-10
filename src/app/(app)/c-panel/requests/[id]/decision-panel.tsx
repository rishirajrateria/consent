"use client";

import { useState } from "react";
import { Card, SectionTitle, Field, Input, Textarea, Select } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { cn } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import { approveRequestAction, requestChangesAction, markPaidAction, denyRequestAction } from "../actions";

type Mode = "approve" | "fee" | "changes" | "deny";

/**
 * The owner's answer, placed at the end of the request page after everything
 * it depends on. One answer at a time, and its button always comes last, so a
 * typed fee or note can't be lost by pressing a different button.
 */
export function DecisionPanel({
  requestId,
  requesterName,
  selections,
  thumbnailUsed,
  isPaid,
  inNegotiation,
  openOffer,
  canNegotiate,
  canSetFee,
  proposeLegalByDefault,
  denialReasons,
}: {
  requestId: string;
  requesterName: string;
  selections: Selection[];
  thumbnailUsed: boolean;
  isPaid: boolean;
  inNegotiation: boolean;
  /** The fee waiting for an answer, if any. */
  openOffer: { id: string; label: string; note: string | null; fromRequester: boolean } | null;
  canNegotiate: boolean;
  /** Can negotiate and still has a counter-offer left, so a new fee can be sent. */
  canSetFee: boolean;
  proposeLegalByDefault: boolean;
  denialReasons: { id: string; label: string }[];
}) {
  // Approving settles an open fee from the requester, so it is the owner's one
  // "yes" to a fee. With the owner's own fee open, the requester answers first.
  const theirFee = openOffer?.fromRequester ? openOffer : null;
  const myFee = openOffer && !openOffer.fromRequester ? openOffer : null;
  const canApprove = !myFee && (!theirFee || canNegotiate);
  const approveLabel = theirFee ? `Approve the deal at ${theirFee.label}` : "Approve";
  const options: [Mode, string][] = [
    ...(canApprove ? ([["approve", approveLabel]] as [Mode, string][]) : []),
    // While a fee is being discussed, counter-offers live in the fee card above.
    ...(inNegotiation || !canSetFee ? [] : ([["fee", "Set a fee"]] as [Mode, string][])),
    ["changes", "Ask for changes"],
    ["deny", "Decline"],
  ];
  const [picked, setMode] = useState<Mode>(options[0][0]);
  // The choices change when the fee does; fall back to the first one.
  const mode = options.some(([m]) => m === picked) ? picked : options[0][0];

  return (
    <Card strong className="space-y-5" id="decide">
      <SectionTitle
        title="Your answer"
        desc="You've seen who's asking, what for and the exact files. Choose your answer, then confirm it at the bottom."
      />
      {myFee && (
        <p className="text-sm text-ink-soft">
          {inNegotiation
            ? `Waiting for ${requesterName} to answer your fee of ${myFee.label}.${canSetFee ? " You can change it in Fee negotiation above." : ""}`
            : canSetFee
              ? `Your fee of ${myFee.label} hasn't been answered yet. Send it again with Set a fee so ${requesterName} can answer it.`
              : canNegotiate
                ? `You've used all your counter-offers. Ask for changes or decline, or ${requesterName} can raise a new request.`
                : `Your fee of ${myFee.label} hasn't been answered yet.`}
        </p>
      )}
      {theirFee && (
        <p className="text-sm text-ink-soft">
          {requesterName} offered {theirFee.label}.{" "}
          {canNegotiate
            ? `Approving accepts this fee.${inNegotiation && canSetFee ? " To ask for a different fee, counter it in Fee negotiation above." : ""}`
            : "Accepting a fee needs the negotiate permission."}
        </p>
      )}
      <div role="radiogroup" aria-label="How do you want to answer?" className="flex flex-wrap gap-2">
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

      {mode === "approve" && (
        <form action={approveRequestAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          {/* The fee on the button; approving fails if it changed meanwhile. */}
          <input type="hidden" name="offerId" value={openOffer?.id ?? ""} />
          <details className="group">
            <summary className="cursor-pointer text-sm font-medium text-ink-soft hover:text-ink">
              Conditions (optional): fewer formats, shorter clips, no thumbnail, shorter validity
            </summary>
            <div className="mt-3 space-y-3 border-l-2 border-ink/10 pl-4">
              <div className="space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Keep only these formats</div>
                {selections.map((s) => (
                  <label key={s.formatId} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="checkbox" name="keepFormat" value={s.formatId} defaultChecked className="size-4 accent-black" />
                    {s.platformName} → {s.formatName}
                    {s.durationSec ? (
                      <span className="flex items-center gap-1 text-xs text-ink-soft">
                        ({s.durationSec}s asked, cap at
                        <input
                          type="number"
                          name={`cap_${s.formatId}`}
                          min={1}
                          max={s.durationSec}
                          placeholder={String(s.durationSec)}
                          className="w-16 rounded-lg border border-ink/10 bg-white/70 px-1.5 py-0.5 text-xs"
                          aria-label={`Cap duration for ${s.formatName}`}
                        />
                        s)
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
              {thumbnailUsed && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="removeThumbnail" className="size-4 accent-black" />
                  Don&apos;t allow the thumbnail
                </label>
              )}
              <Field label="Shorten validity to (end date)">
                <Input name="validUntil" type="date" />
              </Field>
              <Field label="Written condition">
                <Textarea name="conditionsNote" placeholder="e.g. No use in political contexts; credit @janecarter on screen." className="min-h-16" />
              </Field>
            </div>
          </details>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="shareContacts" defaultChecked={isPaid} className="size-4 accent-black" />
            Also share my contact details with {requesterName}
          </label>
          <p className="text-xs text-ink-faint">
            Leave it unticked to just approve. You can share your details later from this page.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="proposeLegal" defaultChecked={proposeLegalByDefault} className="size-4 accent-black" />
            Also propose a legally binding agreement ({requesterName} must accept)
          </label>
          {theirFee && (
            <div className="space-y-1 border-t hairline pt-3">
              {theirFee.note && (
                <p className="text-sm">Their note becomes a condition of this consent: &ldquo;{theirFee.note}&rdquo;</p>
              )}
              <p className="text-xs text-ink-faint">
                You accept {theirFee.label}. The fee is paid directly between you, never through Consent.
              </p>
            </div>
          )}
          <SubmitButton className="w-full sm:w-auto">{approveLabel}</SubmitButton>
        </form>
      )}

      {mode === "fee" && (
        <form action={markPaidAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          <div className="grid gap-3 sm:grid-cols-[8rem_6rem_1fr]">
            <Field label="Fee amount" required>
              <Input name="amount" type="number" step="0.01" min="1" required placeholder="500" />
            </Field>
            <Field label="Currency" required>
              <Input name="currency" defaultValue="USD" maxLength={3} required />
            </Field>
            <Field label="Condition (optional)" hint="Becomes part of the consent if accepted.">
              <Input name="scopeNote" placeholder="e.g. Instagram only, for 3 months" />
            </Field>
          </div>
          <p className="text-xs text-ink-faint">
            {requesterName} can accept it, counter it or walk away. The fee is paid directly between you,
            never through Consent.
          </p>
          <SubmitButton className="w-full sm:w-auto">Send fee</SubmitButton>
        </form>
      )}

      {mode === "changes" && (
        <form action={requestChangesAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          <Field label="What should they change?" hint="They'll upload a revised file and send it back to you.">
            <Textarea name="note" required placeholder="e.g. Trim the clip to 15 seconds and remove the last scene." className="min-h-20" />
          </Field>
          <SubmitButton className="w-full sm:w-auto">Ask for changes</SubmitButton>
        </form>
      )}

      {mode === "deny" && (
        <form action={denyRequestAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Reason (optional)">
              <Select name="reasonId" defaultValue="">
                <option value="">No reason</option>
                {denialReasons.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Details (optional)">
              <Input name="freeText" placeholder="Anything you'd like them to know" />
            </Field>
          </div>
          <p className="text-xs text-ink-faint">A no needs no reason.</p>
          <ConfirmSubmit confirm="Decline this request?" variant="danger" className="w-full sm:w-auto">
            Decline request
          </ConfirmSubmit>
        </form>
      )}
    </Card>
  );
}
