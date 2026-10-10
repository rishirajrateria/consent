import { describe, it, expect } from "vitest";
import { MAX_COUNTER_OFFERS, countersUsed, countersLeft, canSendOffer } from "../negotiation";

const o = (version: number, bySide: "consenter" | "requester") => ({ version, bySide });

describe("counter-offer limit", () => {
  it("allows 3 counter-offers per side", () => {
    expect(MAX_COUNTER_OFFERS).toBe(3);
  });
  it("never counts the opening offer", () => {
    const offers = [o(1, "consenter")];
    expect(countersUsed(offers, "consenter")).toBe(0);
    expect(countersLeft(offers, "consenter")).toBe(3);
    expect(countersLeft(offers, "requester")).toBe(3);
  });
  it("counts each side separately, whatever order the rows arrive in", () => {
    const offers = [o(4, "consenter"), o(2, "requester"), o(1, "consenter"), o(3, "requester")];
    expect(countersUsed(offers, "requester")).toBe(2);
    expect(countersUsed(offers, "consenter")).toBe(1);
    expect(countersLeft(offers, "requester")).toBe(1);
  });
  it("stops a side after its third counter-offer, while the other side can still accept or end", () => {
    const offers = [o(1, "consenter"), o(2, "requester"), o(3, "consenter"), o(4, "requester"), o(5, "consenter"), o(6, "requester"), o(7, "consenter")];
    expect(canSendOffer(offers, "requester")).toBe(false);
    expect(canSendOffer(offers, "consenter")).toBe(false);
    expect(countersLeft(offers, "requester")).toBe(0);
  });
  it("lets either side open the negotiation", () => {
    expect(canSendOffer([], "requester")).toBe(true);
    expect(countersLeft([o(1, "requester")], "requester")).toBe(3);
  });
});
