import { describe, it, expect } from "vitest";
import { ruleMatches, cellAutoApproves, type RuleConditions, type Selection } from "../rules";

const sel = (platformId: string, durationSec?: number): Selection => ({
  platformId,
  platformName: platformId,
  formatId: `${platformId}-f`,
  formatName: "Video",
  durationSec: durationSec ?? null,
});

const baseCtx = {
  requester: { type: "NEWS_CHANNEL", score: 700, categories: ["news"] },
  selections: [sel("yt", 20)],
  assetTypeIds: ["name"],
  whitelisted: true,
};

describe("ruleMatches", () => {
  it("matches when no conditions are set", () => {
    expect(ruleMatches({}, baseCtx)).toBe(true);
  });

  it("enforces whitelistOnly", () => {
    const c: RuleConditions = { whitelistOnly: true };
    expect(ruleMatches(c, baseCtx)).toBe(true);
    expect(ruleMatches(c, { ...baseCtx, whitelisted: false })).toBe(false);
  });

  it("enforces requester type and min score", () => {
    expect(ruleMatches({ requesterTypes: ["PODCAST"] }, baseCtx)).toBe(false);
    expect(ruleMatches({ minScore: 800 }, baseCtx)).toBe(false);
    expect(ruleMatches({ minScore: 650 }, baseCtx)).toBe(true);
  });

  it("requires every selection to be covered by platform filter", () => {
    const ctx = { ...baseCtx, selections: [sel("yt"), sel("ig")] };
    expect(ruleMatches({ platformIds: ["yt"] }, ctx)).toBe(false);
    expect(ruleMatches({ platformIds: ["yt", "ig"] }, ctx)).toBe(true);
  });

  it("rejects when any selection exceeds maxDurationSec", () => {
    expect(ruleMatches({ maxDurationSec: 30 }, baseCtx)).toBe(true);
    expect(ruleMatches({ maxDurationSec: 10 }, baseCtx)).toBe(false);
  });

  it("requires all asset types to be within the allowed set", () => {
    const ctx = { ...baseCtx, assetTypeIds: ["name", "photo"] };
    expect(ruleMatches({ assetTypeIds: ["name"] }, ctx)).toBe(false);
    expect(ruleMatches({ assetTypeIds: ["name", "photo", "voice"] }, ctx)).toBe(true);
  });

  it("matches categories on overlap", () => {
    expect(ruleMatches({ categories: ["news", "sports"] }, baseCtx)).toBe(true);
    expect(ruleMatches({ categories: ["gaming"] }, baseCtx)).toBe(false);
  });
});

describe("cellAutoApproves", () => {
  const allow = { policy: "AUTO_APPROVE" as const, maxDurationSec: null, thumbnailAllowed: true, paidDefault: false };

  it("approves a plain ✓ cell", () => {
    expect(cellAutoApproves(allow, sel("yt", 20), true)).toBe(true);
  });

  it("asks when the cell isn't ✓", () => {
    expect(cellAutoApproves({ ...allow, policy: "ASK" }, sel("yt", 20), false)).toBe(false);
  });

  it("asks when the clip is longer than the row's cap", () => {
    expect(cellAutoApproves({ ...allow, maxDurationSec: 30 }, sel("yt", 20), false)).toBe(true);
    expect(cellAutoApproves({ ...allow, maxDurationSec: 10 }, sel("yt", 20), false)).toBe(false);
  });

  it("asks when the request uses a thumbnail the row doesn't allow", () => {
    const noThumb = { ...allow, thumbnailAllowed: false };
    expect(cellAutoApproves(noThumb, sel("yt", 20), true)).toBe(false);
    expect(cellAutoApproves(noThumb, sel("yt", 20), false)).toBe(true);
  });

  it("asks when the row is paid by default", () => {
    expect(cellAutoApproves({ ...allow, paidDefault: true }, sel("yt", 20), false)).toBe(false);
  });
});
