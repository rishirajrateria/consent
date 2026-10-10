"use server";

import { redirect } from "next/navigation";
import { cancelMeeting, MeetingError, readMeetingInput, scheduleMeeting, type MeetingInput } from "@/lib/meetings";
import { resolveSide } from "./shared-actions";

function panelPath(side: "consenter" | "requester", id: string) {
  return side === "consenter" ? `/c-panel/requests/${id}` : `/r-panel/requests/${id}`;
}
function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

/**
 * Who may arrange a meeting: on the owner's side, the owner or a teammate who
 * can approve or negotiate; on the requester's side, anyone but a viewer.
 */
async function meetingActor(id: string) {
  const resolved = await resolveSide(id);
  const path = panelPath(resolved.side, id);
  if (resolved.side === "consenter") {
    const m = resolved.consenterMember;
    if (!m || (m.role !== "OWNER" && !m.canApprove && !m.canNegotiate))
      fail(path, "Arranging a meeting needs the approve or negotiate permission");
  } else if (!resolved.requesterMember || resolved.requesterMember.role === "VIEWER") {
    fail(path, "Viewers have read-only access");
  }
  return { ...resolved, path };
}

/** What the in-page form gets back when the meeting can't be scheduled: the problem and what was typed. */
export type MeetingFormState = { error: string; values: MeetingInput } | null;

/** Schedule (or move) the meeting; returns the problem in plain words instead of throwing it. */
async function schedule(formData: FormData): Promise<{ path: string; error: string | null }> {
  const id = String(formData.get("id"));
  const { session, side, path } = await meetingActor(id);
  // Without the browser's zone the time would be read as UTC and land at the wrong hour.
  if (!String(formData.get("meeting_tz") ?? "").trim()) {
    return { path, error: "Your time zone couldn't be read. Reload the page and try again." };
  }
  try {
    await scheduleMeeting({
      requestId: id,
      userId: session.userId,
      userName: session.user.name,
      side,
      input: readMeetingInput(formData),
    });
  } catch (e) {
    if (!(e instanceof MeetingError)) throw e;
    return { path, error: e.message };
  }
  return { path, error: null };
}

/** Schedule a meeting on the request, or move the one already scheduled. */
export async function scheduleMeetingAction(formData: FormData) {
  const { path, error } = await schedule(formData);
  // Outside any try: redirect works by throwing.
  if (error) fail(path, error);
  redirect(path);
}

/**
 * The same, for useActionState: a problem comes back to the form with what was
 * typed, so nothing is lost and the form stays open. Success goes back to the page.
 */
export async function scheduleMeetingFormAction(_prev: MeetingFormState, formData: FormData): Promise<MeetingFormState> {
  const { path, error } = await schedule(formData);
  if (error) return { error, values: readMeetingInput(formData) };
  redirect(path);
}

/** Cancel the scheduled meeting; both calendars get a cancellation. */
export async function cancelMeetingAction(formData: FormData) {
  const id = String(formData.get("id"));
  const meetingId = String(formData.get("meetingId") ?? "");
  const { session, side, path } = await meetingActor(id);
  let error: string | null = null;
  try {
    await cancelMeeting({ meetingId, requestId: id, userName: session.user.name, side });
  } catch (e) {
    if (!(e instanceof MeetingError)) throw e;
    error = e.message;
  }
  if (error) fail(path, error);
  redirect(path);
}
