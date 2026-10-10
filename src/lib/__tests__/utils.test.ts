import { describe, it, expect } from "vitest";
import { slugify, normalizeLegalName, scoreBand, statusLabel, eventLabel, shownEvent } from "../utils";

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
  it("labels every request status in plain words", () => {
    expect(statusLabel("PENDING")).toBe("Pending");
    expect(statusLabel("CHANGES_REQUESTED")).toBe("Question asked");
    expect(statusLabel("APPROVED_IN_PRINCIPLE")).toBe("Approved, final file needed");
    expect(statusLabel("APPROVED")).toBe("Approved");
    expect(statusLabel("DENIED")).toBe("Denied");
    expect(statusLabel("CLOSED")).toBe("Closed");
    expect(statusLabel("WITHDRAWN")).toBe("Withdrawn");
  });
});

describe("timeline events", () => {
  it("titles events in plain words", () => {
    expect(eventLabel("submitted")).toBe("Sent");
    expect(eventLabel("auto_approved")).toBe("Approved automatically");
    expect(eventLabel("grant_issued")).toBe("Certificate issued");
    expect(eventLabel("changes_requested")).toBe("Question asked");
    expect(eventLabel("something_new")).toBe("Something New");
  });
  it("skips events from removed features on old timelines", () => {
    for (const type of ["offer_made", "deal_agreed", "agreement_signed", "contacts_shared", "meeting_scheduled"]) {
      expect(shownEvent({ type })).toBe(false);
    }
    expect(shownEvent({ type: "approved" })).toBe(true);
  });
});
