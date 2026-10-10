import { describe, expect, it } from "vitest";
import { askingState, feeLine, type AskingMembership } from "./asking";

const DAY = 86400_000;
const future = () => new Date(Date.now() + 30 * DAY);
const past = () => new Date(Date.now() - DAY);

function seat(
  requesterId: string,
  over: Partial<AskingMembership["requester"]> = {},
  role = "OWNER",
): AskingMembership {
  return {
    requesterId,
    role,
    requester: {
      displayName: `Profile ${requesterId}`,
      status: "APPROVED",
      onboardingFeePaidAt: past(),
      subscriptionEndsAt: future(),
      ...over,
    },
  };
}

describe("askingState", () => {
  it("is none without an asking profile", () => {
    expect(askingState([])).toEqual({ kind: "none" });
  });

  it("is ready with an approved, paid, in-date profile", () => {
    expect(askingState([seat("a")])).toEqual({ kind: "ready", requesterId: "a", name: "Profile a" });
  });

  it("prefers the asking profile already in use", () => {
    expect(askingState([seat("a"), seat("b")], "b")).toMatchObject({ kind: "ready", requesterId: "b" });
    expect(askingState([seat("a"), seat("b")], null)).toMatchObject({ kind: "ready", requesterId: "a" });
  });

  it("skips view-only seats when another profile can send", () => {
    expect(askingState([seat("a", {}, "VIEWER"), seat("b")], "a")).toMatchObject({ kind: "ready", requesterId: "b" });
    expect(askingState([seat("a", {}, "VIEWER")])).toEqual({ kind: "viewOnly", name: "Profile a" });
  });

  it("is unfinished while waiting for approval or payment", () => {
    expect(askingState([seat("a", { status: "PENDING" })])).toEqual({ kind: "unfinished" });
    expect(askingState([seat("a", { onboardingFeePaidAt: null, subscriptionEndsAt: null })])).toEqual({ kind: "unfinished" });
  });

  it("is lapsed when the yearly plan has ended", () => {
    expect(askingState([seat("a", { subscriptionEndsAt: past() })])).toEqual({ kind: "lapsed", requesterId: "a" });
  });

  it("names the lapsed profile to renew, not a pending one or a view-only seat", () => {
    expect(
      askingState([
        seat("a", { status: "PENDING", onboardingFeePaidAt: null, subscriptionEndsAt: null }),
        seat("b", { subscriptionEndsAt: past() }, "VIEWER"),
        seat("c", { subscriptionEndsAt: past() }),
      ]),
    ).toEqual({ kind: "lapsed", requesterId: "c" });
  });
});

describe("feeLine", () => {
  const owner = { consentPrice: "25.00", consentPriceCurrency: "USD" };

  it("shows the base fee plus the platform fee", () => {
    expect(feeLine(owner, [], ["news"])).toEqual({ price: "$25.00", note: " · plus the platform fee" });
  });

  it("never reads as free: no fee still carries the platform fee", () => {
    expect(feeLine({ consentPrice: null, consentPriceCurrency: "USD" }, [], [])).toEqual({
      price: null,
      note: " · plus the platform fee",
    });
  });

  it("shows a range when the fee depends on what it's for", () => {
    expect(feeLine(owner, [{ intentCategoryId: "news", amount: "0" }], ["news", "promo"])).toEqual({
      price: "$0.00 to $25.00",
      note: " · depends on what it's for, plus the platform fee",
    });
  });
});
