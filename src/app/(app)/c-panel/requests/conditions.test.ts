import { describe, expect, it } from "vitest";
import { CONDITION_MAX, conditionProblem } from "./conditions";

describe("conditionProblem", () => {
  it("accepts an empty condition and ordinary scope conditions", () => {
    expect(conditionProblem("")).toBeNull();
    expect(conditionProblem("   ")).toBeNull();
    expect(conditionProblem("No use in political contexts; credit @janecarter on screen.")).toBeNull();
    expect(conditionProblem("Instagram only, for 3 months. Keep the clip under 15 seconds.")).toBeNull();
    expect(conditionProblem("Not in paid ads.")).toBeNull();
    expect(conditionProblem("Not for paid ads")).toBeNull();
    expect(conditionProblem("Credit @x on screen")).toBeNull();
    expect(conditionProblem("No pay-per-view channels.")).toBeNull();
    expect(conditionProblem("Use at most 50% of the clip.")).toBeNull();
    expect(conditionProblem("Limit the amount of footage to 10 seconds.")).toBeNull();
    expect(conditionProblem("Don't transfer this consent to anyone else.")).toBeNull();
  });

  it("refuses a condition that asks for money", () => {
    for (const text of [
      "Pay me ₹5,000 before publishing",
      "$200 upfront",
      "Send 500 rupees",
      "INR 1000 on release",
      "20k USD license fee",
      "An extra fee of 50",
      "Royalties on every view",
      "Revenue share of 10%",
      "Invoice my agency",
      "Send money before publishing",
      "Pay 5000 before you publish",
      "Only if you pay the agreed amount",
      "Give me 10% of the ad revenue",
      "Transfer 2000 to my UPI first",
      "Wire 300 to my bank account",
      "Paid partnership: I get 50 percent of profits",
      "500/- before posting",
      "I want 20% of sales",
      "Deposit it in my bank account",
    ]) {
      expect(conditionProblem(text), text).toMatch(/can't ask for money/);
    }
  });

  it("keeps it short", () => {
    expect(conditionProblem("a".repeat(CONDITION_MAX + 1))).toMatch(/under/);
    expect(conditionProblem("a".repeat(CONDITION_MAX))).toBeNull();
  });
});
