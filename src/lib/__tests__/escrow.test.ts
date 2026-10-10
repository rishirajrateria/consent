import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn() }));
import { escrowOutcome, splitConsentFee } from "../escrow";

describe("ask price escrow", () => {
  it("releases the ask price to the owner on any yes", () => {
    for (const s of ["DEAL_AGREED", "APPROVED_IN_PRINCIPLE", "AGREEMENT_MODE_PENDING", "LEGAL_AGREEMENT_PENDING", "APPROVED"] as const) {
      expect(escrowOutcome(s)).toBe("release");
    }
  });
  it("refunds it on every ending without a yes", () => {
    for (const s of ["DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"] as const) {
      expect(escrowOutcome(s)).toBe("refund");
    }
  });
  it("keeps holding it while the owner hasn't answered", () => {
    for (const s of ["SUBMITTED", "PENDING", "IN_NEGOTIATION", "CHANGES_REQUESTED", "DRAFT"] as const) {
      expect(escrowOutcome(s)).toBe("hold");
    }
  });
});

describe("consent request fee split", () => {
  it("gives the owner 80% on a yes and refunds 80% otherwise; Consent keeps 20%", () => {
    expect(splitConsentFee(10)).toEqual({ gross: 10, owner: 8, refund: 8, consentOnYes: 2, consentOnNo: 2 });
    expect(splitConsentFee(250)).toMatchObject({ owner: 200, refund: 200, consentOnYes: 50 });
  });
  it("rounds to cents without losing money", () => {
    const s = splitConsentFee(0.99);
    expect(s.owner).toBe(0.79);
    expect(Math.round((s.owner + s.consentOnYes) * 100)).toBe(99);
    expect(Math.round((s.refund + s.consentOnNo) * 100)).toBe(99);
  });
});
