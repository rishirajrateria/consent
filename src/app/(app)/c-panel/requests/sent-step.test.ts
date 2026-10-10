import { describe, expect, it } from "vitest";
import type { RequestStatus } from "@prisma/client";
import { actingFor, askerStep, askingSeats, madeBy, sentHref } from "./sent-step";

type Agreement = NonNullable<Parameters<typeof askerStep>[0]["agreement"]>;

function req(status: RequestStatus, extra: Partial<Parameters<typeof askerStep>[0]> = {}) {
  return { status, consenter: { displayName: "Jane Carter" }, offers: [], agreement: null, grant: null, ...extra };
}

function legal(a: Partial<Agreement>) {
  return req("LEGAL_AGREEMENT_PENDING", {
    agreement: {
      status: "PROPOSED",
      proposedBySide: "consenter",
      uploadedFileId: null,
      uploadConfirmedBySide: null,
      signatures: [],
      ...a,
    },
  });
}

describe("askerStep", () => {
  it("waits on the owner until they answer", () => {
    expect(askerStep(req("PENDING"))).toEqual({ move: "them", text: "Waiting for Jane Carter to answer." });
    expect(askerStep(req("SUBMITTED")).move).toBe("them");
  });

  it("asks the asker to answer the owner's question", () => {
    expect(askerStep(req("CHANGES_REQUESTED"))).toEqual({ move: "you", text: "Answer Jane Carter's question." });
  });

  it("follows the open offer in a negotiation", () => {
    expect(askerStep(req("IN_NEGOTIATION", { offers: [{ bySide: "consenter" }] })).move).toBe("you");
    expect(askerStep(req("IN_NEGOTIATION", { offers: [{ bySide: "requester" }] })).move).toBe("them");
    expect(askerStep(req("IN_NEGOTIATION")).move).toBe("either");
  });

  it("works out whose move it is on a legal agreement", () => {
    expect(askerStep(legal({ status: "PROPOSED", proposedBySide: "consenter" })).move).toBe("you");
    expect(askerStep(legal({ status: "PROPOSED", proposedBySide: "requester" })).move).toBe("them");
    expect(askerStep(legal({ status: "DRAFTING" })).move).toBe("you");
    expect(askerStep(legal({ status: "UPLOAD_PENDING_CONFIRMATION" })).text).toBe("Upload the signed agreement.");
    expect(
      askerStep(legal({ status: "UPLOAD_PENDING_CONFIRMATION", uploadedFileId: "f1", uploadConfirmedBySide: "consenter" })).move,
    ).toBe("you");
    expect(
      askerStep(legal({ status: "UPLOAD_PENDING_CONFIRMATION", uploadedFileId: "f1", uploadConfirmedBySide: "requester" })).move,
    ).toBe("them");
    expect(askerStep(legal({ status: "AWAITING_SIGNATURES" })).text).toBe("Sign the legal agreement.");
    expect(askerStep(legal({ status: "AWAITING_SIGNATURES", signatures: [{ side: "requester" }] })).move).toBe("them");
    expect(askerStep(legal({ status: "DECLINED", proposedBySide: "requester" })).move).toBe("you");
    expect(askerStep(legal({ status: "DECLINED", proposedBySide: "consenter" })).move).toBe("them");
    expect(askerStep(req("LEGAL_AGREEMENT_PENDING")).move).toBe("either");
  });

  it("says how an ended request ended", () => {
    expect(askerStep(req("APPROVED", { grant: { status: "ACTIVE" } })).text).toBe("Approved. Your certificate is ready.");
    expect(askerStep(req("APPROVED", { grant: { status: "REVOKED" } })).text).toBe("Jane Carter revoked this consent.");
    expect(askerStep(req("DENIED"))).toEqual({ move: "done", text: "Jane Carter said no." });
    expect(askerStep(req("EXPIRED_NO_RESPONSE")).move).toBe("done");
    expect(askerStep(req("WITHDRAWN")).text).toBe("You withdrew this request.");
  });

  it("marks a draft as the asker's to finish", () => {
    expect(askerStep(req("DRAFT")).move).toBe("you");
  });
});

describe("sentHref", () => {
  it("opens drafts in the editor and everything else on the request page", () => {
    expect(sentHref({ id: "r1", status: "DRAFT" })).toBe("/r-panel/requests/r1/edit");
    expect(sentHref({ id: "r1", status: "PENDING" })).toBe("/r-panel/requests/r1");
  });
});

describe("seats", () => {
  it("leaves view-only seats out of what this person acts on", () => {
    expect(madeBy("u1")).toEqual({ requester: { members: { some: { userId: "u1" } } } });
    expect(actingFor("u1")).toEqual({ requester: { members: { some: { userId: "u1", role: { not: "VIEWER" } } } } });
  });

  it("names the view-only profiles and whether there's more than one", () => {
    const one = askingSeats([{ requesterId: "a", role: "OWNER" }]);
    expect(one.manyProfiles).toBe(false);
    expect(one.viewOnly.size).toBe(0);
    const two = askingSeats([
      { requesterId: "a", role: "OWNER" },
      { requesterId: "b", role: "VIEWER" },
    ]);
    expect(two.manyProfiles).toBe(true);
    expect([...two.viewOnly]).toEqual(["b"]);
  });
});
