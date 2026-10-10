import { describe, it, expect, vi } from "vitest";
vi.mock("../db", () => ({ db: {} }));
import { waitingOn, windowEnd } from "../request-window";
import { evaluateCapacity, pausedMessage } from "../capacity";

const none = { maxOpenRequests: null, dailyRequestLimit: null, weeklyRequestLimit: null, monthlyRequestLimit: null };
const now = new Date("2026-10-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe("request window", () => {
  it("expires a fixed number of days after the last action", () => {
    expect(windowEnd(new Date("2026-10-10T12:00:00Z"), 7).toISOString()).toBe("2026-10-17T12:00:00.000Z");
  });
  it("knows whose move it is", () => {
    expect(waitingOn("PENDING")).toBe("consenter");
    expect(waitingOn("CHANGES_REQUESTED")).toBe("requester");
    expect(waitingOn("IN_NEGOTIATION", "consenter")).toBe("requester");
    expect(waitingOn("IN_NEGOTIATION", "requester")).toBe("consenter");
    expect(waitingOn("AGREEMENT_MODE_PENDING")).toBe("requester");
    expect(waitingOn("LEGAL_AGREEMENT_PENDING")).toBe("either");
  });
});

describe("request limits", () => {
  it("never pauses without limits", () => {
    expect(evaluateCapacity(none, 50, [hoursAgo(1), hoursAgo(2)], now).paused).toBe(false);
  });
  it("pauses at the max waiting until some are answered", () => {
    const c = evaluateCapacity({ ...none, maxOpenRequests: 3 }, 3, [], now);
    expect(c.paused).toBe(true);
    expect(c.untilAnswered).toBe(true);
    expect(c.opensAt).toBeNull();
    expect(evaluateCapacity({ ...none, maxOpenRequests: 3 }, 2, [], now).paused).toBe(false);
  });
  it("reopens a daily limit when the oldest request ages out", () => {
    const c = evaluateCapacity({ ...none, dailyRequestLimit: 2 }, 0, [hoursAgo(20), hoursAgo(5), hoursAgo(30)], now);
    expect(c.paused).toBe(true);
    expect(c.counts.daily).toBe(2);
    expect(c.opensAt!.toISOString()).toBe(new Date(hoursAgo(20).getTime() + 24 * 3600_000).toISOString());
  });
  it("uses the latest reopening when several limits are hit", () => {
    const arrivals = [hoursAgo(2), hoursAgo(50), hoursAgo(100)];
    const c = evaluateCapacity({ ...none, dailyRequestLimit: 1, weeklyRequestLimit: 3 }, 0, arrivals, now);
    expect(c.reasons).toHaveLength(2);
    expect(c.opensAt!.getTime()).toBe(hoursAgo(100).getTime() + 7 * 24 * 3600_000);
  });
  it("explains a pause in one plain sentence", () => {
    const c = evaluateCapacity({ ...none, maxOpenRequests: 1 }, 1, [], now);
    expect(pausedMessage("Jane Carter", c, () => "x")).toBe("Jane Carter has paused new requests until they answer the ones waiting.");
  });
});
