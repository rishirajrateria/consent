import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn() }));
vi.mock("../providers", () => ({ calendar: {} }));
import { zonedToUtc, meetingProblem } from "../meetings";
import { buildIcs, calendarLinks } from "../ics";

describe("meeting times", () => {
  it("turns a local time in the scheduler's zone into the exact instant", () => {
    expect(zonedToUtc("2026-10-14", "15:30", "Asia/Kolkata").toISOString()).toBe("2026-10-14T10:00:00.000Z");
    expect(zonedToUtc("2026-10-14", "09:00", "America/New_York").toISOString()).toBe("2026-10-14T13:00:00.000Z");
    expect(zonedToUtc("2026-12-14", "09:00", "America/New_York").toISOString()).toBe("2026-12-14T14:00:00.000Z");
  });
  it("explains what's missing in plain words", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const ok = { date: "2026-10-14", time: "15:30", timeZone: "Asia/Kolkata", durationMin: 30, mode: "VIDEO" as const };
    expect(meetingProblem(ok, now)).toBeNull();
    expect(meetingProblem({ ...ok, date: "2026-10-01" }, now)).toMatch(/at least 10 minutes/);
    expect(meetingProblem({ ...ok, mode: "IN_PERSON" }, now)).toBe("Add where you'll meet.");
    expect(meetingProblem({ ...ok, link: "javascript:alert(1)" }, now)).toMatch(/https/);
    expect(meetingProblem({ ...ok, timeZone: "Mars/Base" }, now)).toMatch(/time zone/);
  });
});

describe("calendar invites", () => {
  const e = {
    uid: "m1@consent.app", sequence: 0, start: new Date("2026-10-14T10:00:00Z"), end: new Date("2026-10-14T10:30:00Z"),
    title: "Consent: Jane Carter × Acme Clips (request #7)", description: "Video call: https://meet.example/abc",
    attendee: { name: "Jane Carter", email: "mgmt@janecarter.example" },
  };
  it("builds a valid invite that lists only the recipient", () => {
    const raw = buildIcs(e);
    expect(raw.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    const ics = raw.replace(/\r\n /g, ""); // unfold continuation lines
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("DTSTART:20261014T100000Z");
    expect(ics).toContain("mailto:mgmt@janecarter.example");
    expect(ics.match(/ATTENDEE/g)).toHaveLength(1);
  });
  it("cancels the same event", () => {
    const ics = buildIcs({ ...e, sequence: 1, cancelled: true });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("SEQUENCE:1");
    expect(ics).toContain("STATUS:CANCELLED");
  });
  it("makes Google and Outlook add-to-calendar links", () => {
    const l = calendarLinks(e);
    expect(l.google).toContain("dates=20261014T100000Z%2F20261014T103000Z");
    expect(l.outlook).toContain("startdt=2026-10-14T10%3A00%3A00.000Z");
  });
});
