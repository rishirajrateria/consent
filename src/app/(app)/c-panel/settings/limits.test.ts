import { describe, expect, it } from "vitest";
import { readLimits, MAX_LIMIT } from "./limits";

function form(values: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

describe("readLimits", () => {
  it("treats empty or missing boxes as no limit", () => {
    expect(readLimits(form({ maxOpenRequests: "", dailyRequestLimit: "  " }))).toEqual({
      maxOpenRequests: null,
      dailyRequestLimit: null,
      weeklyRequestLimit: null,
      monthlyRequestLimit: null,
    });
  });

  it("reads whole numbers from 1 up", () => {
    expect(
      readLimits(form({ maxOpenRequests: "5", dailyRequestLimit: "1", weeklyRequestLimit: " 20 ", monthlyRequestLimit: String(MAX_LIMIT) })),
    ).toEqual({ maxOpenRequests: 5, dailyRequestLimit: 1, weeklyRequestLimit: 20, monthlyRequestLimit: MAX_LIMIT });
  });

  it("reads other ways of writing a whole number", () => {
    expect(readLimits(form({ maxOpenRequests: "10.0", dailyRequestLimit: "1e3" }))).toEqual({
      maxOpenRequests: 10,
      dailyRequestLimit: 1000,
      weeklyRequestLimit: null,
      monthlyRequestLimit: null,
    });
  });

  it.each(["0", "-1", "2.5", "abc", String(MAX_LIMIT + 1)])("rejects %s", (bad) => {
    expect(readLimits(form({ dailyRequestLimit: bad }))).toBeNull();
  });
});
