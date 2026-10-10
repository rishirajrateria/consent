import type { RequestStatus } from "@prisma/client";
import { CalendarClock, ChevronDown } from "lucide-react";
import { db } from "@/lib/db";
import { MEETING_STATUSES, MODE_LABEL, meetingLinks } from "@/lib/meetings";
import { meetingTitle } from "@/lib/requests";
import { Card, SectionTitle } from "@/components/ui";
import { ConfirmSubmit } from "@/components/form";
import { LocalTime } from "@/components/local-time";
import { ScheduleMeetingForm } from "@/components/meeting-form";
import { cancelMeetingAction } from "@/app/(app)/requests/meeting-actions";

const linkBtn =
  "inline-flex min-h-10 items-center rounded-xl border border-ink/15 bg-white/70 px-3.5 py-2 text-sm font-medium hover:border-ink/30";
const summaryCls =
  "flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-xl text-sm font-medium [&::-webkit-details-marker]:hidden";

/**
 * The meeting on a request, for either side: when (in the viewer's own time
 * zone), how, the note, add-to-calendar links, and moving or cancelling it.
 * With no meeting yet, those who can act get a collapsed "Schedule a
 * meeting". Renders nothing when there's nothing to show.
 */
export async function MeetingCard({
  request,
  side,
  canAct,
}: {
  request: {
    id: string;
    number: number;
    status: RequestStatus;
    consenter: { displayName: string };
    requester: { displayName: string };
  };
  side: "consenter" | "requester";
  /** Whether the viewer may schedule, move or cancel (pages decide by seat). */
  canAct: boolean;
}) {
  const meeting = await db.requestMeeting.findFirst({
    where: { requestId: request.id, status: "SCHEDULED" },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  const open = MEETING_STATUSES.includes(request.status);
  const other = side === "consenter" ? request.requester.displayName : request.consenter.displayName;

  if (!meeting) {
    if (!canAct || !open) return null;
    return (
      <Card className="space-y-3" id="meeting">
        <details className="group space-y-3">
          <summary className={summaryCls}>
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <CalendarClock className="size-4" aria-hidden /> Schedule a meeting
            </span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="text-sm text-ink-soft">
            Talk it through with {other} on a call or in person. It goes into both your calendars.
          </p>
          <ScheduleMeetingForm requestId={request.id} />
        </details>
      </Card>
    );
  }

  const past = meeting.endsAt < new Date();
  const minutes = Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000);
  const links = meetingLinks(meeting, meetingTitle(request), side);
  const canMove = canAct && open;
  // Cancelling tidies both calendars, so it stays possible even after the request ends.
  const canCancel = canAct && !past;

  return (
    <Card className="space-y-4" id="meeting">
      <SectionTitle
        title="Meeting"
        desc={
          past
            ? "This meeting has passed."
            : `Scheduled by ${meeting.createdBy.name}. Shown in your time zone; ${other} sees it in theirs.`
        }
      />
      <dl className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-3">
          <dt className="w-16 shrink-0 text-ink-faint">When</dt>
          <dd className="min-w-0">
            <LocalTime iso={meeting.startsAt.toISOString()} weekday withZone className="font-medium" /> · {minutes} min
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <dt className="w-16 shrink-0 text-ink-faint">How</dt>
          <dd className="min-w-0 break-words">
            {MODE_LABEL[meeting.mode]}
            {meeting.mode === "IN_PERSON" && meeting.location && <> at {meeting.location}</>}
            {meeting.mode === "VIDEO" && meeting.link && (
              <>
                {" · "}
                {/^https:\/\//i.test(meeting.link) ? (
                  <a href={meeting.link} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {meeting.link}
                  </a>
                ) : (
                  meeting.link
                )}
              </>
            )}
            {meeting.mode === "PHONE" && meeting.link && (
              <>
                {" · "}
                <a href={`tel:${meeting.link.replace(/[^\d+]/g, "")}`} className="underline underline-offset-4">
                  {meeting.link}
                </a>
              </>
            )}
          </dd>
        </div>
        {meeting.note && (
          <div className="flex flex-wrap gap-x-3">
            <dt className="w-16 shrink-0 text-ink-faint">Note</dt>
            <dd className="min-w-0 whitespace-pre-wrap break-words">{meeting.note}</dd>
          </div>
        )}
      </dl>

      {!past && (
        <div className="space-y-2">
          <p className="text-xs text-ink-faint">
            A calendar invite was emailed to each of you. To add it yourself:
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={links.google} target="_blank" rel="noreferrer" className={linkBtn}>
              Add to Google Calendar
            </a>
            <a href={links.outlook} target="_blank" rel="noreferrer" className={linkBtn}>
              Add to Outlook
            </a>
            <a href={`/api/meetings/${meeting.id}/ics`} download className={linkBtn}>
              Download .ics
            </a>
          </div>
        </div>
      )}

      {canCancel && (
        <form action={cancelMeetingAction} className="border-t hairline pt-3">
          <input type="hidden" name="id" value={request.id} />
          <input type="hidden" name="meetingId" value={meeting.id} />
          <ConfirmSubmit
            confirm={`Cancel this meeting? It's removed from both calendars and ${other} is told.`}
            variant="ghost"
            className="min-h-10"
          >
            Cancel meeting
          </ConfirmSubmit>
        </form>
      )}

      {canMove && (
        // Keyed by version so a successful move starts again closed, without the last try's state.
        <details key={`${meeting.id}-${meeting.sequence}`} className="group space-y-3 border-t hairline pt-3">
          <summary className={summaryCls}>
            {past ? "Pick a new time" : "Move meeting"}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ScheduleMeetingForm
            requestId={request.id}
            existing={{
              startsAt: meeting.startsAt.toISOString(),
              durationMin: minutes,
              mode: meeting.mode,
              link: meeting.link,
              location: meeting.location,
              note: meeting.note,
            }}
          />
        </details>
      )}
    </Card>
  );
}
