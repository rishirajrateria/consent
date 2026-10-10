import { describe, expect, it } from "vitest";
import { canSend, membershipOk, verified } from "../membership";
import { consentFeeProblem, currencyForCountry, DEFAULT_CURRENCIES, parseConsentFee } from "../currency-rules";
import { entityTypeFor, profileRole, profileScore, requesterTypeFor, senderRole } from "../profiles-pure";

const INR = DEFAULT_CURRENCIES.find((c) => c.code === "INR")!;
const USD = DEFAULT_CURRENCIES.find((c) => c.code === "USD")!;

describe("membership", () => {
  const future = new Date(Date.now() + 86400_000);
  const past = new Date(Date.now() - 86400_000);
  it("is free for now: a verified profile can send without paying", () => {
    expect(canSend({ status: "APPROVED", membershipEndsAt: null }, false)).toBe(true);
  });
  it("needs verification", () => {
    expect(verified({ status: "SUBMITTED" })).toBe(false);
    expect(canSend({ status: "SUBMITTED", membershipEndsAt: future }, false)).toBe(false);
  });
  it("needs a membership that hasn't ended once the fee is on", () => {
    expect(membershipOk({ membershipEndsAt: null }, true)).toBe(false);
    expect(membershipOk({ membershipEndsAt: past }, true)).toBe(false);
    expect(canSend({ status: "APPROVED", membershipEndsAt: future }, true)).toBe(true);
  });
});

describe("consent request fee rules", () => {
  it("allows free (empty or 0)", () => {
    expect(consentFeeProblem("", INR)).toBeNull();
    expect(consentFeeProblem("0", INR)).toBeNull();
    expect(parseConsentFee("")).toBeNull();
    expect(parseConsentFee(0)).toBeNull();
  });
  it("needs at least about ₹100 when paid", () => {
    expect(consentFeeProblem("99", INR)).toMatch(/at least INR 100\.00/);
    expect(consentFeeProblem("100", INR)).toBeNull();
    expect(consentFeeProblem("1.19", USD)).toMatch(/at least USD 1\.20/);
    expect(consentFeeProblem("1.20", USD)).toBeNull();
    expect(parseConsentFee("149.5")).toBe(149.5);
  });
  it("rejects bad numbers and unknown currencies", () => {
    expect(consentFeeProblem("abc", INR)).toMatch(/number/);
    expect(consentFeeProblem("100.123", INR)).toMatch(/number/);
    expect(consentFeeProblem("100", null)).toMatch(/currency/);
  });
  it("picks a currency from the country", () => {
    expect(currencyForCountry("IN")).toBe("INR");
    expect(currencyForCountry("us")).toBe("USD");
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry(null)).toBe("INR");
  });
});

describe("profile pairs", () => {
  it("maps team roles between the halves without granting approval", () => {
    expect(senderRole("OWNER")).toBe("OWNER");
    expect(senderRole("MANAGER")).toBe("EDITOR");
    expect(senderRole("VIEWER")).toBe("VIEWER");
    expect(profileRole("EDITOR")).toBe("MANAGER");
    expect(profileRole("VIEWER")).toBe("VIEWER");
  });
  it("maps profile kinds to sending types and back", () => {
    expect(requesterTypeFor("PERSON")).toBe("INDIVIDUAL_CREATOR");
    expect(requesterTypeFor("TV_SHOW")).toBe("MEDIA_HOUSE");
    expect(requesterTypeFor("BRAND")).toBe("AGENCY");
    expect(entityTypeFor("INDIVIDUAL_CREATOR")).toBe("PERSON");
    expect(entityTypeFor("NEWS_CHANNEL")).toBe("OTHER");
  });
});

describe("one score per profile", () => {
  it("averages answering and asking", () => {
    expect(profileScore(700, 500)).toBe(600);
    expect(profileScore(701, 500)).toBe(601);
    expect(profileScore(640, null)).toBe(640);
  });
});
