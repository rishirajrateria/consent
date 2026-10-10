import { describe, expect, it } from "vitest";
import { checkoutRows, checkoutTotal, paymentParts, PAYMENT_LABEL } from "./lines";

const line = (over: Partial<Parameters<typeof paymentParts>[0]>) => ({
  id: "p1",
  purpose: "CONSENT_PRICE" as const,
  amount: "100.00",
  currency: "INR",
  discount: null,
  couponCode: null,
  tax: null,
  taxLabel: null,
  ...over,
});

describe("payment lines", () => {
  it("names every kind of payment", () => {
    expect(PAYMENT_LABEL).toEqual({
      MEMBERSHIP: "Membership",
      PER_REQUEST: "Platform fee (20%)",
      CONSENT_PRICE: "Consent request fee",
    });
  });

  it("splits a stored platform fee back into the fee, coupon and tax", () => {
    // ₹20 platform fee, 50% coupon → ₹10, plus 18% GST → ₹11.80 charged.
    const p = paymentParts(line({ purpose: "PER_REQUEST", amount: "11.80", discount: "10.00", couponCode: "HALF", tax: "1.80", taxLabel: "GST" }));
    expect(p).toMatchObject({ label: "Platform fee (20%)", fee: 20, discount: 10, tax: 1.8, taxLabel: "GST", total: 11.8 });
  });

  it("lists a request checkout as the fee, the platform fee, then tax, with one total", () => {
    const lines = [
      line({ id: "pf", purpose: "PER_REQUEST", amount: "23.60", tax: "3.60", taxLabel: "GST" }),
      line({ id: "cf" }),
    ];
    expect(checkoutRows(lines).map((r) => [r.label, r.amount])).toEqual([
      ["Consent request fee", 100],
      ["Platform fee (20%)", 20],
      ["GST", 3.6],
    ]);
    expect(checkoutTotal(lines)).toBe("₹123.60");
  });

  it("shows a coupon as money off", () => {
    const rows = checkoutRows([line({ purpose: "MEMBERSHIP", amount: "900.00", discount: "100.00", couponCode: "TEN" })]);
    expect(rows).toEqual([
      { key: "p1", label: "Membership (1 year)", amount: 1000, currency: "INR" },
      { key: "p1:coupon", label: "Coupon TEN", amount: 100, currency: "INR", minus: true },
    ]);
  });

  it("never adds different currencies together", () => {
    expect(checkoutTotal([line({ amount: "100.00" }), line({ id: "p2", amount: "9.00", currency: "USD" })])).toBe("₹100.00 + $9.00");
  });
});
