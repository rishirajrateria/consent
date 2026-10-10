"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import type { CallMode } from "@prisma/client";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { cn } from "@/lib/utils";
import { scheduleMeetingFormAction, type MeetingFormState } from "@/app/(app)/requests/meeting-actions";

// The same choices as DURATIONS and MODE_LABEL in src/lib/meetings.ts, which
// is server-only and checks what's sent again.
const DURATIONS = [15, 30, 45, 60, 90] as const;
const MODES: [CallMode, string][] = [
  ["VIDEO", "Video call"],
  ["PHONE", "Phone call"],
  ["IN_PERSON", "In person"],
];

const durationLabel = (min: number) =>
  min < 60 ? `${min} min` : min % 60 === 0 ? `${min / 60} hour${min > 60 ? "s" : ""}` : `${Math.floor(min / 60)} h ${min % 60} min`;

const noSubscription = () => () => {};
const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-10-14T15:30" in the browser's own time zone. */
const localStamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export type MeetingDefaults = {
  /** An existing meeting's start (ISO), shown as the viewer's own date and time. */
  startsAt?: string;
  /** The date and time as the viewer typed them ("2026-10-14", "15:30"); used over startsAt. */
  date?: string;
  time?: string;
  durationMin?: number;
  mode?: CallMode;
  link?: string | null;
  location?: string | null;
  note?: string | null;
};

/**
 * The meeting inputs, named prefix + date, time, duration, mode, link,
 * location and note, plus a hidden prefix + tz with the browser's time zone,
 * so the time is read in the zone of the person scheduling. Read them on the
 * server with readMeetingInput(formData, prefix).
 */
export function MeetingFields({ prefix = "meeting_", defaults }: { prefix?: string; defaults?: MeetingDefaults }) {
  // The server can't know the viewer's zone; these fill in as the page loads.
  const tz = useSyncExternalStore(noSubscription, browserZone, () => "");
  // The earliest and latest start the server takes (10 minutes to a year from
  // now), as local "YYYY-MM-DDTHH:MM", so the browser catches them first.
  const earliest = useSyncExternalStore(noSubscription, () => localStamp(new Date(Date.now() + 11 * 60_000)), () => "");
  const latest = useSyncExternalStore(noSubscription, () => localStamp(new Date(Date.now() + 365 * 86400_000)), () => "");
  const start = useSyncExternalStore(
    noSubscription,
    () => (defaults?.startsAt ? localStamp(new Date(defaults.startsAt)) : ""),
    () => "",
  );
  const [startDate, startTime] = start ? start.split("T") : ["", ""];
  const date = defaults?.date ?? startDate;
  const time = defaults?.time ?? startTime;
  // The date picked now, to limit the time on the first and last day.
  const [picked, setPicked] = useState<string | null>(null);
  const day = picked ?? date;
  const [minDate, minTime] = earliest ? earliest.split("T") : ["", ""];
  const [maxDate, maxTime] = latest ? latest.split("T") : ["", ""];
  const [mode, setMode] = useState<CallMode>(defaults?.mode ?? "VIDEO");
  const sameMode = (m: CallMode) => (defaults?.mode === m ? defaults : undefined);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" required>
          {/* Keyed so the local date fills in once the browser's zone is known. */}
          <Input
            key={`date-${date}`}
            name={`${prefix}date`}
            type="date"
            required
            min={minDate || undefined}
            max={maxDate || undefined}
            defaultValue={date}
            onChange={(e) => setPicked(e.target.value)}
          />
        </Field>
        <Field label="Time" required>
          <Input
            key={`time-${time}`}
            name={`${prefix}time`}
            type="time"
            required
            min={day && day === minDate ? minTime : undefined}
            max={day && day === maxDate ? maxTime : undefined}
            defaultValue={time}
          />
        </Field>
        <Field label="Length">
          <Select name={`${prefix}duration`} defaultValue={String(defaults?.durationMin ?? 30)}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {durationLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-ink-faint">
        {tz ? `In your time zone (${tz}). The other side sees it in theirs.` : "In your time zone. The other side sees it in theirs."}
      </p>
      <input type="hidden" name={`${prefix}tz`} value={tz} />

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">How</legend>
        <div className="flex flex-wrap gap-2">
          {MODES.map(([m, label]) => (
            <label
              key={m}
              className={cn(
                "min-h-10 cursor-pointer rounded-xl px-3.5 py-2 text-sm font-medium transition-all has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ink/10",
                mode === m ? "glass-ink" : "border border-ink/10 bg-white/60 text-ink-soft hover:bg-white hover:text-ink",
              )}
            >
              <input
                type="radio"
                name={`${prefix}mode`}
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "VIDEO" && (
        <Field label="Video link" hint="Optional. You can add it later by moving the meeting.">
          <Input
            key="VIDEO"
            name={`${prefix}link`}
            type="url"
            inputMode="url"
            pattern="https://.*"
            placeholder="https://meet.google.com/abc-defg-hij"
            defaultValue={sameMode("VIDEO")?.link ?? ""}
          />
        </Field>
      )}
      {mode === "PHONE" && (
        <Field label="Number to call" hint="Optional.">
          <Input key="PHONE" name={`${prefix}link`} type="tel" placeholder="+1 555 0100" defaultValue={sameMode("PHONE")?.link ?? ""} />
        </Field>
      )}
      {mode === "IN_PERSON" && (
        <Field label="Place" required>
          <Input
            key="IN_PERSON"
            name={`${prefix}location`}
            required
            placeholder="e.g. Blue Tokai, Bandra West, Mumbai"
            defaultValue={sameMode("IN_PERSON")?.location ?? ""}
          />
        </Field>
      )}

      <Field label="Note" hint="Optional. For example, what you'd like to talk about.">
        <Textarea name={`${prefix}note`} maxLength={1000} className="min-h-16" defaultValue={defaults?.note ?? ""} />
      </Field>
    </div>
  );
}

/** Schedule a meeting on a request, or move the one that's scheduled. */
export function ScheduleMeetingForm({
  requestId,
  existing,
}: {
  requestId: string;
  /** The scheduled meeting, to move it. */
  existing?: MeetingDefaults & { startsAt: string };
}) {
  // A problem comes back here with what was typed, so the form stays open and filled in.
  const [state, formAction, pending] = useActionState<MeetingFormState, FormData>(scheduleMeetingFormAction, null);
  // Until the browser's zone is known the time can't be read right, so wait for it.
  const tz = useSyncExternalStore(noSubscription, browserZone, () => "");
  const typed = state?.values;
  const defaults: MeetingDefaults | undefined = typed
    ? {
        date: typed.date,
        time: typed.time,
        durationMin: typed.durationMin,
        mode: typed.mode,
        link: typed.link,
        location: typed.location,
        note: typed.note,
      }
    : existing;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={requestId} />
      {/* Keyed so the fields start again from what was typed after each try. */}
      <MeetingFields key={typed ? JSON.stringify(typed) : "start"} defaults={defaults} />
      <p className="text-xs text-ink-faint">
        {existing
          ? "You both get an updated calendar invite."
          : "You both get a calendar invite. Each invite lists only its own person, so no one's email is shared."}
      </p>
      <ErrorNote error={state?.error} />
      <SubmitButton className="w-full sm:w-auto" disabled={!tz || pending}>
        {existing ? "Move meeting" : "Schedule meeting"}
      </SubmitButton>
    </form>
  );
}
