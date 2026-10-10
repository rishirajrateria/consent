/* Requests this person sent from any profile they belong to, for Requests →
   Sent and Home: whose move it is and the next step, in one short line. Pure,
   so it can be tested without a database. */

import type { Prisma, RequestStatus } from "@prisma/client";

/** What a sent-request row needs to work out its next step. */
export const sentInclude = {
  consenter: { select: { displayName: true, slug: true } },
  requester: { select: { id: true, displayName: true } },
  grant: { select: { status: true } },
} satisfies Prisma.ConsentRequestInclude;

export type SentRequest = Prisma.ConsentRequestGetPayload<{ include: typeof sentInclude }>;

/** Requests sent from any profile this user is a member of, view-only seats included. */
export function madeBy(userId: string): Prisma.ConsentRequestWhereInput {
  return { requester: { members: { some: { userId } } } };
}

/**
 * Requests sent from a profile where this user can act: every seat but
 * VIEWER. Use it for "waiting on you" counts and drafts, since a viewer can't
 * answer, send or edit anything.
 */
export function actingFor(userId: string): Prisma.ConsentRequestWhereInput {
  return { requester: { members: { some: { userId, role: { not: "VIEWER" } } } } };
}

/**
 * From this person's seats on the sending halves of their profiles: do they
 * send from more than one profile (so each row names the one it was sent
 * from), and on which do they only have a view-only seat?
 */
export function askingSeats(seats: { requesterId: string; role: string }[]) {
  return {
    manyProfiles: seats.length > 1,
    viewOnly: new Set(seats.filter((s) => s.role === "VIEWER").map((s) => s.requesterId)),
  };
}

/** The query behind askingSeats(). */
export function seatsQuery(userId: string) {
  return { where: { userId }, select: { requesterId: true, role: true } } satisfies Prisma.RequesterMemberFindManyArgs;
}

/**
 * Open requests where the next move is the asker's: answer a question, or
 * upload the final content file after a yes. The "waiting on you" count on
 * Requests → Sent and on Home both use it, so they agree.
 */
export const ASKER_MOVE: Prisma.ConsentRequestWhereInput = {
  status: { in: ["CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE"] },
};

/** you: the asker acts next · them: the person asked does · either: both can · done: it has ended. */
export type Move = "you" | "them" | "either" | "done";

export type Step = { move: Move; text: string };

type StepInput = {
  status: RequestStatus;
  consenter: { displayName: string };
  grant: { status: string } | null;
};

/** The asker's next step on a request they made, in plain words. */
export function askerStep(r: StepInput): Step {
  const owner = r.consenter.displayName;
  switch (r.status) {
    case "DRAFT":
      return { move: "you", text: "Not sent yet. Finish it and send it." };
    case "SUBMITTED":
    case "PENDING":
      return { move: "them", text: `Waiting for ${owner} to answer.` };
    case "CHANGES_REQUESTED":
      return { move: "you", text: `Answer ${owner}'s question.` };
    case "APPROVED_IN_PRINCIPLE":
      return { move: "you", text: "Upload the final content file to get your certificate." };
    case "APPROVED":
      if (r.grant?.status === "REVOKED") return { move: "done", text: `${owner} revoked this consent.` };
      if (r.grant?.status === "EXPIRED") return { move: "done", text: "Approved. This consent has expired." };
      if (r.grant?.status === "ACTIVE") return { move: "done", text: "Approved. Your certificate is ready." };
      return { move: "done", text: "Approved." };
    case "DENIED":
      return { move: "done", text: `${owner} said no.` };
    case "EXPIRED_NO_RESPONSE":
      return { move: "done", text: `${owner} didn't answer in time.` };
    case "CLOSED":
      return { move: "done", text: "Closed." };
    case "WITHDRAWN":
      return { move: "done", text: "You withdrew this request." };
    default:
      return { move: "either", text: "In progress." };
  }
}

/** Where a sent request opens: drafts open in the editor. */
export function sentHref(r: { id: string; status: RequestStatus }): string {
  return r.status === "DRAFT" ? `/r-panel/requests/${r.id}/edit` : `/r-panel/requests/${r.id}`;
}
