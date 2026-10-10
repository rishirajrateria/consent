import { describe, expect, it } from "vitest";
import { readFeeForm, tierMode } from "./fee-form";
import { DEFAULT_CURRENCIES } from "../../../../lib/currency-rules";

const intents = [
  { id: "news", name: "News" },
  { id: "ads", name: "Promotion" },
];

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("consent request fee form", () => {
  it("saves a free fee", () => {
    const r = readFeeForm(form({ feeMode: "free", consentPrice: "500", consentPriceCurrency: "INR" }), DEFAULT_CURRENCIES, intents);
    expect(r).toEqual({ ok: true, fee: { consentPrice: null, currency: "INR", tiers: new Map([["news", null], ["ads", null]]) } });
  });

  it("saves a fee at or above the currency's minimum", () => {
    const r = readFeeForm(form({ feeMode: "paid", consentPrice: "100", consentPriceCurrency: "inr" }), DEFAULT_CURRENCIES, intents);
    expect(r.ok && r.fee.consentPrice).toBe(100);
    const usd = readFeeForm(form({ feeMode: "paid", consentPrice: "1.20", consentPriceCurrency: "USD" }), DEFAULT_CURRENCIES, intents);
    expect(usd.ok && usd.fee).toMatchObject({ consentPrice: 1.2, currency: "USD" });
  });

  it("refuses a fee below the minimum, an empty fee and a missing choice", () => {
    expect(readFeeForm(form({ feeMode: "paid", consentPrice: "99", consentPriceCurrency: "INR" }), DEFAULT_CURRENCIES, intents)).toEqual({
      ok: false,
      error: "Your consent request fee must be at least ₹100.00, or choose Free.",
    });
    expect(readFeeForm(form({ feeMode: "paid", consentPrice: "", consentPriceCurrency: "INR" }), DEFAULT_CURRENCIES, intents)).toEqual({
      ok: false,
      error: "Enter your consent request fee, or choose Free.",
    });
    expect(readFeeForm(form({ feeMode: "paid", consentPrice: "abc", consentPriceCurrency: "INR" }), DEFAULT_CURRENCIES, intents)).toEqual({
      ok: false,
      error: "Enter the fee as a number, like 100 or 149.50.",
    });
    expect(readFeeForm(form({ consentPriceCurrency: "INR" }), DEFAULT_CURRENCIES, intents).ok).toBe(false);
  });

  it("refuses a currency people can't choose", () => {
    expect(readFeeForm(form({ feeMode: "free", consentPriceCurrency: "XYZ" }), DEFAULT_CURRENCIES, intents)).toEqual({
      ok: false,
      error: "Choose a currency we support for your consent request fee.",
    });
  });

  it("reads a fee per kind of consent: the profile's fee, free, or at least the minimum", () => {
    const r = readFeeForm(
      form({
        feeMode: "free",
        consentPriceCurrency: "INR",
        tierMode_news: "free",
        tierMode_ads: "paid",
        tier_ads: "2500",
      }),
      DEFAULT_CURRENCIES,
      intents,
    );
    expect(r.ok && [...r.fee.tiers]).toEqual([
      ["news", 0],
      ["ads", 2500],
    ]);
    expect(
      readFeeForm(form({ feeMode: "free", consentPriceCurrency: "INR", tierMode_ads: "paid", tier_ads: "50" }), DEFAULT_CURRENCIES, intents),
    ).toEqual({ ok: false, error: "The fee for Promotion must be at least ₹100.00, or choose Free." });
  });

  it("shows a stored tier as the profile's fee, free, or a fee", () => {
    expect(tierMode(null)).toBe("base");
    expect(tierMode("0.00")).toBe("free");
    expect(tierMode("250.00")).toBe("paid");
  });
});
