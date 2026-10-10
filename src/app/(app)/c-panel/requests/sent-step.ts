/* Requests this person made from any asking (requester) profile they belong
   to, seen from the owner workspace: whose move it is and the next step, in
   one short line. Pure, so it can be tested without a database. */

import type { Prisma, RequestStatus } from "@prisma/client";

/** What a sent-request row needs to work out its next step. */
export const sentInclude = {
  consenter: { select: { displayName: true, slug: true } },
  requester: { select: { id: true, displayName: true } },
  offers: { where: { status: "OPEN" }, select: { bySide: true } },
  agreement: {
    select: {
      status: true,
      proposedBySide: true,
      uploadedFileId: true,
      uploadConfirmedBySide: true,
      signatures: { select: { side: true } },
    },
  },
  grant: { select: { status: true } },
} satisfies Prisma.ConsentRequestInclude;

export type SentRequest = Prisma.ConsentRequestGetPayload<{ include: typeof sentInclude }>;

/** Requests made from any requester profile this user is a member of, view-only seats included. */
export function madeBy(userId: string): Prisma.ConsentRequestWhereInput {
  return { requester: { members: { some: { userId } } } };
}

/**
 * Requests made from a requester profile where this user can act: every seat
 * but VIEWER. Use it for "waiting on you" counts and drafts, since a viewer
 * can't answer, send or edit anything.
 */
export function actingFor(userId: string): Prisma.ConsentRequestWhereInput {
  return { requester: { members: { some: { userId, role: { not: "VIEWER" } } } } };
}

/**
 * From this person's requester seats: do they ask as more than one profile
 * (so each row names the one it was sent from), and on which profiles do
 * they only have a view-only seat?
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
 * Open requests where the next move is the asker's. Same rules as the
 * "waiting on you" count on the requester home (/r-panel), so both agree.
 */
export const ASKER_MOVE: Prisma.ConsentRequestWhereInput = {
  OR: [
    { status: { in: ["CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE", "AGREEMENT_MODE_PENDING"] } },
    { status: "IN_NEGOTIATION", offers: { some: { status: "OPEN", bySide: "consenter" } } },
    {
      status: "LEGAL_AGREEMENT_PENDING",
      agreement: {
        OR: [
          { status: "PROPOSED", proposedBySide: "consenter" },
          { status: "DRAFTING" },
          { status: "UPLOAD_PENDING_CONFIRMATION", uploadedFileId: null },
          { status: "UPLOAD_PENDING_CONFIRMATION", uploadConfirmedBySide: "consenter" },
          { status: "AWAITING_SIGNATURES", signatures: { none: { side: "requester" } } },
          { status: "DECLINED", proposedBySide: "requester" },
        ],
      },
    },
  ],
};

/** you: the asker acts next · them: the owner does · either: both can · done: it has ended. */
export type Move = "you" | "them" | "either" | "done";

export type Step = { move: Move; text: string };

type StepInput = {
  status: RequestStatus;
  consenter: { displayName: string };
  offers: { bySide: string }[];
  agreement: {
    status: string;
    proposedBySide: string;
    uploadedFileId: string | null;
    uploadConfirmedBySide: string | null;
    signatures: { side: string }[];
  } | null;
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
    case "IN_NEGOTIATION": {
      // Only the latest offer can still be open.
      const open = r.offers[0];
      if (open?.bySide === "consenter") return { move: "you", text: `Reply to ${owner}'s offer.` };
      if (open?.bySide === "requester") return { move: "them", text: `Waiting for ${owner} to reply to your offer.` };
      return { move: "either", text: "Either of you can make the next offer." };
    }
    case "DEAL_AGREED":
      return { move: "either", text: "Fee agreed. The agreement comes next." };
    case "APPROVED_IN_PRINCIPLE":
      return { move: "you", text: "Upload the final content file to get your certificate." };
    case "AGREEMENT_MODE_PENDING":
      return { move: "you", text: "Choose how to record the agreement." };
    case "LEGAL_AGREEMENT_PENDING":
      return legalStep(r.agreement, owner);
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
      return { move: "done", text: "Closed without a deal." };
    case "WITHDRAWN":
      return { move: "done", text: "You withdrew this request." };
    default:
      return { move: "either", text: "In progress." };
  }
}

function legalStep(a: StepInput["agreement"], owner: string): Step {
  if (!a) return { move: "either", text: "Legal agreement in progress." };
  switch (a.status) {
    case "PROPOSED":
      return a.proposedBySide === "consenter"
        ? { move: "you", text: `Accept or decline ${owner}'s legal agreement.` }
        : { move: "them", text: `Waiting for ${owner} to accept your legal agreement.` };
    case "DRAFTING":
      return { move: "you", text: "Choose how to make the legal agreement." };
    case "UPLOAD_PENDING_CONFIRMATION":
      if (!a.uploadedFileId) return { move: "you", text: "Upload the signed agreement." };
      return a.uploadConfirmedBySide === "consenter"
        ? { move: "you", text: `Check the signed agreement ${owner} uploaded.` }
        : { move: "them", text: `Waiting for ${owner} to check the signed agreement.` };
    case "AWAITING_SIGNATURES":
      return a.signatures.some((s) => s.side === "requester")
        ? { move: "them", text: `Waiting for ${owner} to sign.` }
        : { move: "you", text: "Sign the legal agreement." };
    case "DECLINED":
      return a.proposedBySide === "requester"
        ? { move: "you", text: `${owner} declined the legal agreement. Choose what's next.` }
        : { move: "them", text: `Waiting for ${owner} to choose what's next.` };
    default:
      return { move: "either", text: "Legal agreement in progress." };
  }
}

/** Where a sent request opens in the requester workspace: drafts open in the editor. */
export function sentHref(r: { id: string; status: RequestStatus }): string {
  return r.status === "DRAFT" ? `/r-panel/requests/${r.id}/edit` : `/r-panel/requests/${r.id}`;
}
