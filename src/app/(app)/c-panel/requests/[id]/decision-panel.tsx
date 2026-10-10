"use client";

import { useState } from "react";
import { Card, SectionTitle, Field, Input, Textarea, Select } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { cn } from "@/lib/utils";
import type { Selection } from "@/lib/rules";
import { approveRequestAction, requestChangesAction, denyRequestAction } from "../actions";
import { CONDITION_HINT, CONDITION_MAX } from "../conditions";

type Mode = "approve" | "ask" | "deny";

const ACTION: Record<Mode, (formData: FormData) => Promise<void>> = {
  approve: approveRequestAction,
  ask: requestChangesAction,
  deny: denyRequestAction,
};

/** The day before a date as "YYYY-MM-DD": the latest end date that still shortens it. */
function dayBefore(iso: string) {
  return new Date(new Date(iso).getTime() - 86400_000).toISOString().slice(0, 10);
}

/**
 * The owner's answer, placed at the end of the request page after everything
 * it depends on. One choice (Approve, Ask or Decline) and one confirm button
 * at the very end, so a typed note can't be lost by pressing a different one.
 */
export function DecisionPanel({
  requestId,
  requesterName,
  selections,
  thumbnailUsed,
  validUntil,
  minEnd,
  hasRaw,
  canAsk,
  denialReasons,
}: {
  requestId: string;
  requesterName: string;
  selections: Selection[];
  thumbnailUsed: boolean;
  /**
   * The end of the time window they asked for (ISO): a shorter one must come
   * before it. Null when they didn't ask for a time window (single
   * publication, perpetual): there is no end date to move, so no field.
   */
  validUntil: string | null;
  /** The earliest end date that still leaves some time ("YYYY-MM-DD", tomorrow). */
  minEnd: string;
  /** The final content file is uploaded, so approving issues the certificate at once. */
  hasRaw: boolean;
  /** False while an earlier question is still waiting for their answer. */
  canAsk: boolean;
  denialReasons: { id: string; label: string }[];
}) {
  const options: [Mode, string][] = [
    ["approve", "Approve"],
    ...(canAsk ? ([["ask", "Ask"]] as [Mode, string][]) : []),
    ["deny", "Decline"],
  ];
  const [mode, setMode] = useState<Mode>("approve");
  const maxDate = validUntil ? dayBefore(validUntil) : undefined;
  const conditionsList = [
    "fewer formats",
    "shorter clips",
    ...(thumbnailUsed ? ["no thumbnail"] : []),
    ...(validUntil ? ["shorter validity"] : []),
    "a written condition",
  ].join(", ");

  return (
    <Card strong className="space-y-5" id="decide">
      <SectionTitle
        title="Your answer"
        desc="You've seen who's asking, what for and the exact files. Choose your answer, then confirm it at the bottom."
      />
      <form action={ACTION[mode]} className="space-y-5">
        <input type="hidden" name="id" value={requestId} />
        <div role="radiogroup" aria-label="How do you want to answer?" className="flex flex-wrap gap-2">
          {options.map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "min-h-10 rounded-xl px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10",
                mode === m ? "glass-ink" : "border border-ink/10 bg-white/60 text-ink-soft hover:bg-white hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "approve" && (
          <div className="space-y-3">
            <details className="group">
              <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-ink-soft hover:text-ink">
                Conditions (optional): {conditionsList}
              </summary>
              <div className="mt-3 space-y-4 border-l-2 border-ink/10 pl-4">
                <fieldset className="space-y-1.5">
                  <legend className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Keep only these formats</legend>
                  {/* Tells the server these ticks were sent, so unticking one removes it. */}
                  <input type="hidden" name="formatsShown" value="1" />
                  {selections.map((s) => (
                    <div key={s.formatId} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <label className="flex min-h-10 items-center gap-2">
                        <input type="checkbox" name="keepFormat" value={s.formatId} defaultChecked className="size-4 accent-black" />
                        {s.platformName} → {s.formatName}
                      </label>
                      {s.durationSec ? (
                        <label className="flex items-center gap-1 text-xs text-ink-soft">
                          {s.durationSec}s asked, cap at
                          <input
                            type="number"
                            name={`cap_${s.formatId}`}
                            min={1}
                            max={s.durationSec}
                            placeholder={String(s.durationSec)}
                            className="w-16 rounded-lg border border-ink/10 bg-white/70 px-1.5 py-1 text-xs"
                            aria-label={`Shorter length for ${s.platformName} ${s.formatName}, in seconds`}
                          />
                          s
                        </label>
                      ) : null}
                    </div>
                  ))}
                </fieldset>
                {thumbnailUsed && (
                  <label className="flex min-h-10 items-center gap-2 text-sm">
                    <input type="checkbox" name="removeThumbnail" className="size-4 accent-black" />
                    Don&apos;t allow the thumbnail
                  </label>
                )}
                {validUntil && (
                  <Field
                    label="Shorter validity: ends on"
                    hint="Only a date before the end they asked for. Leave it empty to keep theirs."
                  >
                    <Input name="validUntil" type="date" min={minEnd} max={maxDate} />
                  </Field>
                )}
                <Field label="Written condition" hint={CONDITION_HINT}>
                  <Textarea
                    name="conditionsNote"
                    maxLength={CONDITION_MAX}
                    placeholder="e.g. No use in political contexts. Credit @janecarter on screen."
                    className="min-h-16"
                  />
                </Field>
              </div>
            </details>
            <p className="text-xs text-ink-faint">
              {hasRaw
                ? "Approving issues the certificate at once, locked to the exact files above."
                : `${requesterName} hasn't uploaded the final content file yet. Approving now is a yes in principle: the certificate is issued once they upload it.`}
            </p>
          </div>
        )}

        {mode === "ask" && (
          <Field
            label="What do you want to ask or change?"
            required
            hint={`${requesterName} answers in writing and can update their plan or upload a new file. Then it comes back to you.`}
          >
            <Textarea
              name="note"
              required
              maxLength={2000}
              placeholder="e.g. Where will this run? Or: trim the clip to 15 seconds."
              className="min-h-20"
            />
          </Field>
        )}

        {mode === "deny" && (
          <div className="space-y-3">
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
                <Input name="freeText" maxLength={500} placeholder="Anything you'd like them to know" />
              </Field>
            </div>
            <p className="text-xs text-ink-faint">A no needs no reason.</p>
          </div>
        )}

        {mode === "deny" ? (
          <ConfirmSubmit confirm="Decline this request?" variant="danger" className="w-full sm:w-auto">
            Decline request
          </ConfirmSubmit>
        ) : (
          <SubmitButton className="w-full sm:w-auto">{mode === "approve" ? "Approve" : "Send"}</SubmitButton>
        )}
      </form>
    </Card>
  );
}
