import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn(), notifyUser: vi.fn(), notifySide: vi.fn() }));
vi.mock("../providers", () => ({ email: {}, sms: {}, paymentProviderFor: vi.fn() }));
import { windowStep, REMIND_BEFORE_MS } from "../jobs";
import { pausedNotice, fmtUtc, sentences } from "../requests";
import { evaluateCapacity } from "../capacity";

const now = new Date("2026-10-10T12:00:00Z");
const hours = (h: number) => h * 3600_000;
const at = (msFromNow: number) => new Date(now.getTime() + msFromNow);

describe("the request window sweep", () => {
  const base = { lastActivityAt: at(-hours(24)), remindedAt: null };

  it("does nothing while plenty of time is left", () => {
    expect(windowStep({ ...base, status: "PENDING", expiresAt: at(hours(72)) }, now)).toEqual({ kind: "none" });
  });

  it("reminds whoever's move it is once under 48 hours remain", () => {
    expect(windowStep({ ...base, status: "PENDING", expiresAt: at(REMIND_BEFORE_MS - 1) }, now)).toEqual({
      kind: "remind",
      waiting: "consenter",
    });
    expect(windowStep({ ...base, status: "CHANGES_REQUESTED", expiresAt: at(hours(10)) }, now)).toEqual({
      kind: "remind",
      waiting: "requester",
    });
    // A yes waiting for the final file: the asker's move.
    expect(windowStep({ ...base, status: "APPROVED_IN_PRINCIPLE", expiresAt: at(hours(10)) }, now)).toEqual({
      kind: "remind",
      waiting: "requester",
    });
  });

  it("reminds only once per window", () => {
    const reminded = { ...base, remindedAt: at(-hours(1)), status: "PENDING" as const, expiresAt: at(hours(10)) };
    expect(windowStep(reminded, now).kind).toBe("none");
    // Someone acted after that reminder: a fresh window, so a fresh reminder later.
    const acted = { ...reminded, lastActivityAt: at(-hours(0.5)) };
    expect(windowStep(acted, now).kind).toBe("remind");
  });

  it("expires unanswered when it was the owner's move", () => {
    expect(windowStep({ ...base, status: "PENDING", expiresAt: at(-1) }, now)).toEqual({ kind: "expire" });
    expect(windowStep({ ...base, status: "SUBMITTED", expiresAt: at(0) }, now)).toEqual({ kind: "expire" });
  });

  it("closes when it was the asker's move", () => {
    expect(windowStep({ ...base, status: "CHANGES_REQUESTED", expiresAt: at(-1) }, now)).toEqual({
      kind: "close",
      waiting: "requester",
    });
    expect(windowStep({ ...base, status: "APPROVED_IN_PRINCIPLE", expiresAt: at(0) }, now)).toEqual({
      kind: "close",
      waiting: "requester",
    });
  });

  it("leaves requests nobody has a move on alone", () => {
    for (const status of ["DRAFT", "APPROVED", "DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"] as const) {
      expect(windowStep({ ...base, status, expiresAt: at(-hours(100)) }, now)).toEqual({ kind: "none" });
    }
  });
});

describe("the paused notice", () => {
  const none = { maxOpenRequests: null, dailyRequestLimit: null, weeklyRequestLimit: null, monthlyRequestLimit: null };
  const fmt = (d: Date) => d.toISOString().slice(0, 16);

  it("says why and that answering reopens it", () => {
    const n = pausedNotice(evaluateCapacity({ ...none, maxOpenRequests: 2 }, 2, [], now), fmt);
    expect(n.title).toBe("New requests are paused");
    expect(n.body).toBe(
      "New requests are paused: 2 requests waiting for an answer (the limit is 2). They open again when you answer some of the waiting requests. You can change your request limits in settings.",
    );
  });

  it("says when a time limit opens again", () => {
    const c = evaluateCapacity({ ...none, dailyRequestLimit: 1 }, 0, [at(-hours(2))], now);
    expect(pausedNotice(c, fmt).body).toContain("They open again 2026-10-11T10:00.");
  });
});

describe("notification text", () => {
  it("writes times for notifications in UTC, labelled", () => {
    // Punctuation varies a little between ICU versions; the parts don't.
    expect(fmtUtc(new Date("2026-10-17T12:00:00Z"))).toMatch(/^Sat,? 17 Oct 2026,? 12:00 UTC$/);
  });

  it("joins sentences and skips the empty ones (a free request has no refund line)", () => {
    expect(sentences("Jane did not respond.", "", null, false, " You can send a new request. ")).toBe(
      "Jane did not respond. You can send a new request.",
    );
  });
});

describe("local times", () => {
  it("formats a moment in a given zone, with the zone when asked", async () => {
    const { formatMoment } = await import("../../components/local-time");
    const iso = "2026-10-14T10:00:00.000Z";
    expect(formatMoment(iso, { timeZone: "Asia/Kolkata" })).toMatch(/Oct 14, 2026,? 03:30\sPM/);
    expect(formatMoment(iso, { timeZone: "UTC", withZone: true, weekday: true })).toMatch(/^Wed, Oct 14, 2026,? 10:00\sAM UTC$/);
    expect(formatMoment("not a date")).toBe("—");
  });
});
