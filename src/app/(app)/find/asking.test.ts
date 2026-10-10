import { describe, expect, it } from "vitest";
import { askingState, feeLine, type AskingMembership } from "./asking";

const DAY = 86400_000;
const future = () => new Date(Date.now() + 30 * DAY);
const past = () => new Date(Date.now() - DAY);

function seat(
  profileId: string,
  over: Partial<AskingMembership["profile"]> = {},
  role = "OWNER",
): AskingMembership {
  return {
    profileId,
    role,
    profile: { displayName: `Profile ${profileId}`, status: "APPROVED", membershipEndsAt: null, ...over },
  };
}

describe("askingState with the membership fee off (free for now)", () => {
  const off = false;

  it("is none without a profile", () => {
    expect(askingState([], null, off)).toEqual({ kind: "none" });
  });

  it("is ready for every verified profile, no membership needed", () => {
    expect(askingState([seat("a")], null, off)).toEqual({ kind: "ready", profileId: "a", name: "Profile a" });
    expect(askingState([seat("a", { membershipEndsAt: past() })], null, off)).toMatchObject({ kind: "ready" });
  });

  it("prefers the active profile", () => {
    expect(askingState([seat("a"), seat("b")], "b", off)).toMatchObject({ kind: "ready", profileId: "b" });
    expect(askingState([seat("a"), seat("b")], null, off)).toMatchObject({ kind: "ready", profileId: "a" });
  });

  it("asks as another profile when the active one only has a view-only seat", () => {
    expect(askingState([seat("a", {}, "VIEWER"), seat("b")], "a", off)).toMatchObject({ kind: "ready", profileId: "b" });
    expect(askingState([seat("a", {}, "VIEWER")], "a", off)).toEqual({ kind: "viewOnly", name: "Profile a" });
  });

  it("lets managers ask", () => {
    expect(askingState([seat("a", {}, "MANAGER")], "a", off)).toMatchObject({ kind: "ready", profileId: "a" });
  });

  it("is unverified until the ID check is approved", () => {
    for (const status of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "MORE_INFO_NEEDED", "REJECTED"]) {
      expect(askingState([seat("a", { status })], "a", off)).toEqual({ kind: "unverified" });
    }
  });

  it("points to their own profile's ID check before a view-only seat elsewhere", () => {
    expect(askingState([seat("a", { status: "SUBMITTED" }), seat("b", { displayName: "Brand" }, "VIEWER")], "a", off)).toEqual({
      kind: "unverified",
    });
  });

  it("never asks for a membership while the fee is off", () => {
    expect(askingState([seat("a", { status: "SUBMITTED" }), seat("b", { membershipEndsAt: past() })], "a", off)).toMatchObject({
      kind: "ready",
      profileId: "b",
    });
  });
});

describe("askingState with the membership fee on", () => {
  const on = true;

  it("is ready with a membership that hasn't ended", () => {
    expect(askingState([seat("a", { membershipEndsAt: future() })], "a", on)).toMatchObject({ kind: "ready", profileId: "a" });
  });

  it("needs a membership when there is none or it has ended", () => {
    expect(askingState([seat("a")], "a", on)).toEqual({ kind: "membership", profileId: "a" });
    expect(askingState([seat("a", { membershipEndsAt: past() })], "a", on)).toEqual({ kind: "membership", profileId: "a" });
  });

  it("names a profile this person can pay for, not an unverified one or a view-only seat", () => {
    expect(
      askingState(
        [seat("a", { status: "SUBMITTED" }), seat("b", {}, "VIEWER"), seat("c", { membershipEndsAt: past() })],
        "b",
        on,
      ),
    ).toEqual({ kind: "membership", profileId: "c" });
  });

  it("offers a membership for their own profile before a view-only seat elsewhere", () => {
    expect(
      askingState(
        [seat("a", { membershipEndsAt: past() }), seat("b", { displayName: "Brand", membershipEndsAt: future() }, "VIEWER")],
        "b",
        on,
      ),
    ).toEqual({ kind: "membership", profileId: "a" });
  });

  it("is view-only when their only seat that can send is a viewer's", () => {
    expect(askingState([seat("b", { displayName: "Brand", membershipEndsAt: future() }, "VIEWER")], "b", on)).toEqual({
      kind: "viewOnly",
      name: "Brand",
    });
  });

  it("is still unverified before the ID check, whatever the membership", () => {
    expect(askingState([seat("a", { status: "SUBMITTED", membershipEndsAt: future() })], "a", on)).toEqual({ kind: "unverified" });
  });
});

describe("feeLine", () => {
  const owner = { consentPrice: "500.00", consentPriceCurrency: "INR" };

  it("is free to ask without a consent request fee", () => {
    expect(feeLine({ consentPrice: null, consentPriceCurrency: "INR" }, [], [])).toEqual({ free: true });
    expect(feeLine({ consentPrice: "0", consentPriceCurrency: "INR" }, [], ["news"])).toEqual({ free: true });
  });

  it("shows the fee plus the 20% platform fee, in the profile's currency", () => {
    expect(feeLine(owner, [], ["news"])).toEqual({ free: false, price: "₹500.00", note: " + 20% platform fee" });
    expect(feeLine({ consentPrice: "25.00", consentPriceCurrency: "USD" }, [], [])).toEqual({
      free: false,
      price: "$25.00",
      note: " + 20% platform fee",
    });
  });

  it("shows a range when the fee depends on what it's for", () => {
    expect(feeLine(owner, [{ intentCategoryId: "news", amount: "100" }], ["news", "promo"])).toEqual({
      free: false,
      price: "₹100.00 to ₹500.00",
      note: " + 20% platform fee · depends on what it's for",
    });
  });

  it("says when some uses are free", () => {
    expect(feeLine(owner, [{ intentCategoryId: "news", amount: "0" }], ["news", "promo"])).toEqual({
      free: false,
      price: "up to ₹500.00",
      note: " + 20% platform fee · free for some uses",
    });
  });

  it("is free when every use is free, and charges when only a per-use fee is set", () => {
    expect(feeLine({ consentPrice: null, consentPriceCurrency: "INR" }, [{ intentCategoryId: "news", amount: "0" }], ["news"])).toEqual({
      free: true,
    });
    expect(
      feeLine({ consentPrice: null, consentPriceCurrency: "INR" }, [{ intentCategoryId: "promo", amount: "250" }], ["news", "promo"]),
    ).toEqual({ free: false, price: "up to ₹250.00", note: " + 20% platform fee · free for some uses" });
  });
});
