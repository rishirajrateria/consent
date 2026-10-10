import { describe, expect, it } from "vitest";
import type { RequestStatus } from "@prisma/client";
import { ASKER_MOVE, actingFor, askerStep, askingSeats, madeBy, sentHref } from "./sent-step";

function req(status: RequestStatus, extra: Partial<Parameters<typeof askerStep>[0]> = {}) {
  return { status, consenter: { displayName: "Jane Carter" }, grant: null, ...extra };
}

describe("askerStep", () => {
  it("waits on the owner until they answer", () => {
    expect(askerStep(req("PENDING"))).toEqual({ move: "them", text: "Waiting for Jane Carter to answer." });
    expect(askerStep(req("SUBMITTED")).move).toBe("them");
  });

  it("asks the asker to answer the owner's question", () => {
    expect(askerStep(req("CHANGES_REQUESTED"))).toEqual({ move: "you", text: "Answer Jane Carter's question." });
  });

  it("asks for the final content file after a yes in principle", () => {
    expect(askerStep(req("APPROVED_IN_PRINCIPLE"))).toEqual({
      move: "you",
      text: "Upload the final content file to get your certificate.",
    });
  });

  it("says how an ended request ended", () => {
    expect(askerStep(req("APPROVED", { grant: { status: "ACTIVE" } })).text).toBe("Approved. Your certificate is ready.");
    expect(askerStep(req("APPROVED", { grant: { status: "REVOKED" } })).text).toBe("Jane Carter revoked this consent.");
    expect(askerStep(req("DENIED"))).toEqual({ move: "done", text: "Jane Carter said no." });
    expect(askerStep(req("EXPIRED_NO_RESPONSE")).move).toBe("done");
    expect(askerStep(req("WITHDRAWN")).text).toBe("You withdrew this request.");
    expect(askerStep(req("CLOSED"))).toEqual({ move: "done", text: "Closed." });
  });

  it("marks a draft as the asker's to finish", () => {
    expect(askerStep(req("DRAFT")).move).toBe("you");
  });
});

describe("ASKER_MOVE", () => {
  it("is the asker's move only to answer a question or upload the final file", () => {
    expect(ASKER_MOVE).toEqual({ status: { in: ["CHANGES_REQUESTED", "APPROVED_IN_PRINCIPLE"] } });
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
