import { describe, it, expect } from "vitest";
import { slugify, normalizeLegalName, scoreBand, statusLabel } from "../utils";

describe("slugify", () => {
  it("lowercases and strips punctuation", () => {
    expect(slugify("Jane Carter!")).toBe("jane-carter");
  });
  it("handles accents and falls back for empty input", () => {
    expect(slugify("Café Münch")).toBe("cafe-munch");
    expect(slugify("!!!")).toBe("profile");
  });
});

describe("normalizeLegalName", () => {
  it("normalizes case, punctuation and spacing for duplicate detection", () => {
    expect(normalizeLegalName("  Jane  E. CARTER ")).toBe(normalizeLegalName("jane e carter"));
  });
});

describe("scoreBand", () => {
  it("maps scores to bands", () => {
    expect(scoreBand(900)).toBe("Excellent");
    expect(scoreBand(700)).toBe("Good");
    expect(scoreBand(500)).toBe("Fair");
    expect(scoreBand(100)).toBe("Poor");
  });
});

describe("statusLabel", () => {
  it("humanizes known statuses and falls back to title case", () => {
    expect(statusLabel("EXPIRED_NO_RESPONSE")).toBe("Expired (no response)");
    expect(statusLabel("SOME_NEW_STATE")).toBe("Some New State");
  });
});
