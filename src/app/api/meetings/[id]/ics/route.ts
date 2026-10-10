import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buildIcs } from "@/lib/ics";
import { meetingDescription, meetingTitle } from "@/lib/requests";

/**
 * A request meeting as a calendar file (.ics) for the signed-in person, on
 * either side of the request. Like the emailed invites, it lists only that
 * person, so it never shows anyone else's email. Anyone else gets a 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getSession();
  // The same bar as the request pages: a verified email and, where on, a passed 2FA check.
  if (!session || !session.user.emailVerified || (session.user.totpEnabled && !session.totpPassed)) return notFound();

  const meeting = await db.requestMeeting.findUnique({
    where: { id },
    include: { request: { include: { consenter: true, requester: true } } },
  });
  if (!meeting) return notFound();
  const { request } = meeting;
  const [cm, rm] = await Promise.all([
    db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: request.consenterId, userId: session.userId } },
    }),
    db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
    }),
  ]);
  const side = cm ? "consenter" : rm ? "requester" : null;
  if (!side) return notFound();

  const ics = buildIcs({
    uid: `${meeting.id}@consent.app`,
    sequence: meeting.sequence,
    start: meeting.startsAt,
    end: meeting.endsAt,
    title: meetingTitle(request),
    description: meetingDescription(meeting, side),
    location: meeting.mode === "IN_PERSON" ? meeting.location ?? undefined : meeting.link ?? undefined,
    attendee: { name: session.user.name, email: session.user.email },
    cancelled: meeting.status === "CANCELLED",
  });
  return new Response(ics, {
    headers: {
      "Content-Type": `text/calendar; charset=utf-8; method=${meeting.status === "CANCELLED" ? "CANCEL" : "REQUEST"}`,
      "Content-Disposition": `attachment; filename="consent-request-${request.number}-meeting.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
