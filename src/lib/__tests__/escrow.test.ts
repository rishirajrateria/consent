import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn() }));
import { escrowOutcome } from "../escrow";

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
