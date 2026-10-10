"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, SectionTitle, Field, Input, Textarea, Select } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { cn } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import { MeetingFields } from "@/components/meeting-form";
import { approveRequestAction, requestChangesAction, markPaidAction, denyRequestAction } from "../actions";
import type { ContactChoice } from "../contact-fields";
import { ContactChoices } from "./contact-choices";

type Mode = "approve" | "fee" | "ask" | "deny";

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
  canAsk,
  contactChoices,
  hasMeeting,
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
  /** False while an earlier question is still waiting for their answer. */
  canAsk: boolean;
  /** The owner's contact details, for "Share my contact details". */
  contactChoices: ContactChoice[];
  /** A meeting is already scheduled, so approving can't add another. */
  hasMeeting: boolean;
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
    ...(canAsk ? ([["ask", "Ask"]] as [Mode, string][]) : []),
    ["deny", "Decline"],
  ];
  const [picked, setMode] = useState<Mode>(options[0][0]);
  // The choices change when the fee does; fall back to the first one.
  const mode = options.some(([m]) => m === picked) ? picked : options[0][0];
  // A paid deal needs a way to settle the fee, so sharing starts ticked when
  // the profile shares at least one detail it has.
  const canShare = contactChoices.some((c) => c.value);
  const [share, setShare] = useState(isPaid && contactChoices.some((c) => c.defaultOn));
  const [meet, setMeet] = useState(false);
  const [noneTicked, setNoneTicked] = useState(false);
  const [meetingIssue, setMeetingIssue] = useState<string | null>(null);

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
                ? `You've used all your counter-offers. ${canAsk ? "Ask a question or decline" : "Decline"}, or ${requesterName} can raise a new request.`
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
        <form
          action={approveRequestAction}
          className="space-y-3"
          onSubmit={(e) => {
            // Sharing with nothing ticked would share nothing; say so before anything is sent.
            const ticked = e.currentTarget.querySelector('input[name="shareField"]:checked');
            if (share && canShare && !ticked) {
              e.preventDefault();
              setNoneTicked(true);
            }
            // A meeting time that has passed would be refused after approving; catch it
            // here so nothing typed is lost. The browser reads it in the owner's zone.
            if (meet && !hasMeeting) {
              const issue = meetingTimeIssue(e.currentTarget);
              setMeetingIssue(issue);
              if (issue) e.preventDefault();
            }
          }}
        >
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
          <div className="space-y-2">
            <label className={cn("flex items-center gap-2 text-sm", !canShare && "text-ink-faint")}>
              <input
                type="checkbox"
                name="shareContacts"
                checked={share && canShare}
                disabled={!canShare}
                onChange={(e) => {
                  setShare(e.target.checked);
                  setNoneTicked(false);
                }}
                className="size-4 accent-black"
              />
              Share my contact details with {requesterName}
            </label>
            {share && canShare ? (
              <div className="space-y-1.5 border-l-2 border-ink/10 pl-4">
                <div onChange={() => setNoneTicked(false)}>
                  <ContactChoices choices={contactChoices} />
                </div>
                <p className={cn("text-xs", noneTicked ? "font-medium text-ink" : "text-ink-faint")} role={noneTicked ? "alert" : undefined}>
                  {noneTicked
                    ? "Tick at least one detail, or untick Share my contact details."
                    : "Only the details you tick are shared."}
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-faint">
                {canShare ? (
                  "Leave it unticked to just approve. You can share your details later from this page."
                ) : (
                  <>
                    You haven&apos;t added any contact details yet.{" "}
                    <Link
                      href="/c-panel/settings"
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-4 hover:text-ink"
                    >
                      Add them in settings<span className="sr-only"> (opens in a new tab)</span>
                    </Link>{" "}
                    to share them.
                  </>
                )}
              </p>
            )}
          </div>
          {hasMeeting ? (
            // One meeting per request; scheduling here would move the one already set.
            <p className="text-sm text-ink-soft">A meeting is already scheduled. You can move it in Meeting above.</p>
          ) : (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="scheduleMeeting"
                  checked={meet}
                  onChange={(e) => {
                    setMeet(e.target.checked);
                    setMeetingIssue(null);
                  }}
                  className="size-4 accent-black"
                />
                Also schedule a meeting
              </label>
              {meet && (
                <div className="space-y-2 border-l-2 border-ink/10 pl-4" onChange={() => setMeetingIssue(null)}>
                  <MeetingFields prefix="meeting_" />
                  <p
                    className={cn("text-xs", meetingIssue ? "font-medium text-ink" : "text-ink-faint")}
                    role={meetingIssue ? "alert" : undefined}
                  >
                    {meetingIssue ?? "You both get a calendar invite."}
                  </p>
                </div>
              )}
            </div>
          )}
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

      {mode === "ask" && (
        <form action={requestChangesAction} className="space-y-3">
          <input type="hidden" name="id" value={requestId} />
          <Field
            label="What do you want to ask or change?"
            required
            hint={`${requesterName} answers in writing and can update their plan or upload a new file. Then it comes back to you.`}
          >
            <Textarea
              name="note"
              required
              placeholder="e.g. Where will this run? Or: trim the clip to 15 seconds."
              className="min-h-20"
            />
          </Field>
          <SubmitButton className="w-full sm:w-auto">Send</SubmitButton>
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

/** The same time limits the server checks, read from the meeting's date and time inputs. */
function meetingTimeIssue(form: HTMLFormElement): string | null {
  const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
  const date = value("meeting_date");
  const time = value("meeting_time");
  if (!date || !time) return null;
  const start = new Date(`${date}T${time}`).getTime();
  if (Number.isNaN(start)) return null;
  if (start < Date.now() + 10 * 60_000) return "Pick a time at least 10 minutes from now.";
  if (start > Date.now() + 365 * 86_400_000) return "Pick a time within the next year.";
  return null;
}
