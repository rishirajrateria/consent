import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn() }));
import type { RequestStatus } from "@prisma/client";
import { escrowOutcome, splitConsentFee, YES_STATUSES, NO_STATUSES } from "../escrow";

const ALL: RequestStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "PENDING",
  "CHANGES_REQUESTED",
  "APPROVED_IN_PRINCIPLE",
  "APPROVED",
  "DENIED",
  "CLOSED",
  "EXPIRED_NO_RESPONSE",
  "WITHDRAWN",
];

describe("consent request fee escrow", () => {
  it("counts only an approval as a yes (with or without the final file)", () => {
    expect([...YES_STATUSES].sort()).toEqual(["APPROVED", "APPROVED_IN_PRINCIPLE"]);
  });
  it("releases the owner's share of the consent request fee on a yes", () => {
    for (const s of ["APPROVED_IN_PRINCIPLE", "APPROVED"] as const) expect(escrowOutcome(s)).toBe("release");
  });
  it("refunds it on every ending without a yes", () => {
    expect([...NO_STATUSES].sort()).toEqual(["CLOSED", "DENIED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"]);
    for (const s of NO_STATUSES) expect(escrowOutcome(s)).toBe("refund");
  });
  it("keeps holding it while the owner hasn't answered", () => {
    for (const s of ["DRAFT", "SUBMITTED", "PENDING", "CHANGES_REQUESTED"] as const) expect(escrowOutcome(s)).toBe("hold");
  });
  it("gives every status exactly one outcome", () => {
    const outcomes = ALL.map(escrowOutcome);
    expect(outcomes.filter((o) => o === "release")).toHaveLength(2);
    expect(outcomes.filter((o) => o === "refund")).toHaveLength(4);
    expect(outcomes.filter((o) => o === "hold")).toHaveLength(4);
  });
});

describe("consent request fee split", () => {
  it("gives the owner 80% on a yes and refunds 80% otherwise; Consent keeps 20%", () => {
    expect(splitConsentFee(100)).toEqual({ gross: 100, owner: 80, refund: 80, consentOnYes: 20, consentOnNo: 20 });
    expect(splitConsentFee(250)).toMatchObject({ owner: 200, refund: 200, consentOnYes: 50 });
  });
  it("works at the smallest paid fees", () => {
    expect(splitConsentFee(1.2)).toMatchObject({ owner: 0.96, refund: 0.96, consentOnYes: 0.24 });
    expect(splitConsentFee(149.5)).toMatchObject({ owner: 119.6, consentOnYes: 29.9 });
  });
  it("rounds to cents without losing money", () => {
    const s = splitConsentFee(0.99);
    expect(s.owner).toBe(0.79);
    expect(Math.round((s.owner + s.consentOnYes) * 100)).toBe(99);
    expect(Math.round((s.refund + s.consentOnNo) * 100)).toBe(99);
  });
});
