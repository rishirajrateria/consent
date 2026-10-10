import { describe, expect, it } from "vitest";
import { PLATFORM_PCT, PLATFORM_SHARE, platformFeeFor, requestCharges } from "../platform-fee";
import { OWNER_SHARE } from "../escrow";

describe("platform fee", () => {
  it("is 20% of the consent request fee, the same share Consent keeps from that fee", () => {
    expect(PLATFORM_SHARE).toBe(0.2);
    expect(PLATFORM_PCT).toBe("20%");
    expect(PLATFORM_SHARE).toBeCloseTo(1 - OWNER_SHARE);
    expect(platformFeeFor(10)).toBe(2);
    expect(platformFeeFor(100)).toBe(20);
    expect(platformFeeFor("250.00")).toBe(50);
    expect(platformFeeFor(9.99)).toBe(2);
  });

  it("is nothing when asking is free", () => {
    expect(platformFeeFor(null)).toBe(0);
    expect(platformFeeFor(0)).toBe(0);
    expect(requestCharges(null)).toEqual({
      consentFee: 0,
      platformFee: 0,
      discount: 0,
      tax: 0,
      platformTotal: 0,
      total: 0,
      free: true,
    });
  });

  it("adds the platform fee on top of the consent request fee", () => {
    const c = requestCharges(10);
    expect(c).toMatchObject({ consentFee: 10, platformFee: 2, platformTotal: 2, total: 12, free: false });
  });

  it("takes a coupon off the platform fee only, then taxes what is left of it", () => {
    const c = requestCharges(100, { percentOff: 50, taxRate: 18 });
    expect(c.platformFee).toBe(20);
    expect(c.discount).toBe(10);
    expect(c.tax).toBe(1.8);
    expect(c.platformTotal).toBe(11.8);
    expect(c.total).toBe(111.8);
  });
});
