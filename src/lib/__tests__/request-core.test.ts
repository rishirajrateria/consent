import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn(), notifyUser: vi.fn(), notifySide: vi.fn() }));
vi.mock("../providers", () => ({ calendar: {}, email: {}, sms: {}, paymentProviderFor: vi.fn() }));
import { windowStep, REMIND_BEFORE_MS } from "../jobs";
import {
  contactCard,
  defaultContactFields,
  sharedFields,
  pausedNotice,
  meetingTitle,
  meetingDescription,
  fmtUtc,
} from "../requests";
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
    expect(windowStep({ ...base, status: "LEGAL_AGREEMENT_PENDING", expiresAt: at(hours(10)) }, now)).toEqual({
      kind: "remind",
      waiting: "either",
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
    expect(
      windowStep({ ...base, status: "IN_NEGOTIATION", latestOpenOfferBy: "requester", expiresAt: at(-1) }, now),
    ).toEqual({ kind: "expire" });
  });

  it("closes when it was anyone else's move", () => {
    expect(windowStep({ ...base, status: "CHANGES_REQUESTED", expiresAt: at(-1) }, now)).toEqual({
      kind: "close",
      waiting: "requester",
    });
    expect(
      windowStep({ ...base, status: "IN_NEGOTIATION", latestOpenOfferBy: "consenter", expiresAt: at(-1) }, now),
    ).toEqual({ kind: "close", waiting: "requester" });
    expect(windowStep({ ...base, status: "IN_NEGOTIATION", expiresAt: at(0) }, now)).toEqual({
      kind: "close",
      waiting: "either",
    });
  });
});

describe("contact choices", () => {
  const profile = {
    displayName: "Jane Carter",
    contactEmail: "mgmt@janecarter.example",
    contactPhone: "  ",
    contactAddress: "12 Hill Road\nMumbai",
    managerContact: null,
    shareEmail: true,
    sharePhone: true,
    shareAddress: false,
    shareManager: true,
  };

  it("defaults to the profile's share switches", () => {
    expect(defaultContactFields(profile)).toEqual(["email", "phone", "manager"]);
    const card = contactCard(profile);
    // Phone is switched on but blank, and there's no manager: neither is shared.
    expect(card).toEqual({ name: "Jane Carter", email: "mgmt@janecarter.example", phone: null, address: null, manager: null });
    expect(sharedFields(card)).toEqual(["email"]);
  });

  it("shares only the ticked details that have a value", () => {
    const card = contactCard(profile, ["address", "manager"]);
    expect(card.email).toBeNull();
    expect(card.address).toBe("12 Hill Road\nMumbai");
    expect(sharedFields(card)).toEqual(["address"]);
    expect(sharedFields(contactCard(profile, []))).toEqual([]);
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

describe("meeting calendar text", () => {
  const request = { number: 7, consenter: { displayName: "Jane Carter" }, requester: { displayName: "Acme Clips" } };

  it("titles the event the same everywhere", () => {
    expect(meetingTitle(request)).toBe("Consent: Jane Carter × Acme Clips (request #7)");
  });

  it("describes how to join and links each side to its own page", () => {
    const m = { requestId: "r1", mode: "VIDEO" as const, link: "https://meet.example/abc", location: null, note: "Intro" };
    const d = meetingDescription(m, "requester");
    expect(d).toContain("Video call: https://meet.example/abc");
    expect(d).toContain("Intro");
    expect(d).toMatch(/\/r-panel\/requests\/r1$/);
    expect(meetingDescription({ ...m, mode: "IN_PERSON", link: null, location: "Studio 4", note: null }, "consenter")).toMatch(
      /^In person at Studio 4\n\nRequest on Consent: .*\/c-panel\/requests\/r1$/,
    );
  });

  it("writes times for notifications in UTC, labelled", () => {
    // Punctuation varies a little between ICU versions; the parts don't.
    expect(fmtUtc(new Date("2026-10-17T12:00:00Z"))).toMatch(/^Sat,? 17 Oct 2026,? 12:00 UTC$/);
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
