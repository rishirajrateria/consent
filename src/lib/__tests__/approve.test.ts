import { describe, it, expect, vi, beforeEach } from "vitest";

/* approveAndIssue and onRequestPaid against a small in-memory stand-in for
   the database: what moves, what gets issued, released and told. */

const h = vi.hoisted(() => {
  type Req = {
    id: string;
    number: number;
    status: string;
    consenterId: string;
    requesterId: string;
    selections: unknown;
    assetTypeIds: string[];
    assetTypeNames: string[];
    thumbnailUsed: boolean;
    validUntil: Date | null;
    files: { kind: string }[];
    consenter: { displayName: string };
    requester: {
      id: string;
      consenterId: string | null;
      type: string;
      score: number;
      categories: string[];
      displayName: string;
      consenter?: { score: number } | null;
    };
    [k: string]: unknown;
  };
  const state = { request: null as Req | null, events: [] as { type: string; actorSide: string; detail: unknown }[], paidCount: 0 };
  const tx = {
    consentRequest: {
      updateMany: vi.fn(async ({ where, data }: { where: { status: string | { in: string[] } }; data: Record<string, unknown> }) => {
        const r = state.request!;
        const ok = typeof where.status === "string" ? r.status === where.status : where.status.in.includes(r.status);
        if (!ok) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.request!, data)),
    },
    requestEvent: {
      create: vi.fn(async ({ data }: { data: { type: string; actorSide: string; detail: unknown } }) => {
        state.events.push(data);
        return data;
      }),
    },
  };
  const db = {
    ...tx,
    consentRequest: {
      ...tx.consentRequest,
      findUnique: vi.fn(async () => state.request),
      findUniqueOrThrow: vi.fn(async () => state.request),
    },
    payment: { count: vi.fn(async () => state.paidCount), findMany: vi.fn(async () => []) },
    consenterMember: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === "function" ? arg(tx) : Promise.all(arg as unknown[]))),
  };
  return { state, db };
});

vi.mock("../db", () => ({ db: h.db }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn(), notifyUser: vi.fn() }));
vi.mock("../grants", () => ({
  issueGrant: vi.fn(async () => {
    h.state.request!.status = "APPROVED";
    return { id: "g1" };
  }),
}));
vi.mock("../escrow", () => ({ syncConsentPrice: vi.fn(async () => "none"), splitConsentFee: vi.fn() }));
vi.mock("../score", () => ({ recalcConsenterScore: vi.fn() }));
vi.mock("../settings", () => ({ getSettings: vi.fn(async () => ({ slaDays: 7 })) }));
vi.mock("../capacity", () => ({ requestCapacity: vi.fn(async () => ({ paused: false })) }));
vi.mock("../rules", () => ({ evaluateAutoDecision: vi.fn(async () => ({ kind: "none" })) }));

import { approveAndIssue, ApprovalError, askerScore, onRequestPaid } from "../requests";
import { issueGrant } from "../grants";
import { syncConsentPrice } from "../escrow";
import { notifyConsenterTeam, notifyRequesterTeam } from "../notify";
import { recalcConsenterScore } from "../score";
import { evaluateAutoDecision } from "../rules";

const selections = [{ platformId: "yt", platformName: "YouTube", formatId: "shorts", formatName: "Shorts", durationSec: 30 }];

function request(over: Partial<NonNullable<typeof h.state.request>> = {}) {
  h.state.request = {
    id: "r1",
    number: 7,
    status: "PENDING",
    consenterId: "jane",
    requesterId: "acme-asks",
    selections,
    assetTypeIds: ["name"],
    assetTypeNames: ["Name"],
    thumbnailUsed: true,
    validUntil: null,
    files: [{ kind: "ASSET" }],
    consenter: { displayName: "Jane Carter" },
    requester: { id: "acme-asks", consenterId: "acme", type: "MEDIA_HOUSE", score: 500, categories: [], displayName: "Acme Clips" },
    ...over,
  };
  h.state.events = [];
}

const owner = { requestId: "r1", decidedById: "u1", decidedByName: "Jane Carter", actorSide: "consenter" as const };

beforeEach(() => {
  vi.clearAllMocks();
  h.state.paidCount = 0;
});

describe("approveAndIssue", () => {
  it("issues the certificate at once when the final file is uploaded", async () => {
    request({ files: [{ kind: "ASSET" }, { kind: "RAW_CONTENT" }] });
    await expect(approveAndIssue(owner)).resolves.toBe("APPROVED");
    expect(issueGrant).toHaveBeenCalledWith("r1", "Jane Carter");
    expect(h.state.request!.decidedById).toBe("u1");
    expect(h.state.request!.decidedAt).toBeInstanceOf(Date);
    expect(h.state.events.map((e) => e.type)).toEqual(["approved"]);
    expect(syncConsentPrice).toHaveBeenCalledWith("r1");
  });

  it("waits for the final file when there is none yet, and tells the asker", async () => {
    request();
    await expect(approveAndIssue(owner)).resolves.toBe("APPROVED_IN_PRINCIPLE");
    expect(issueGrant).not.toHaveBeenCalled();
    expect(h.state.request!.status).toBe("APPROVED_IN_PRINCIPLE");
    expect(notifyRequesterTeam).toHaveBeenCalledWith(
      "acme-asks",
      expect.objectContaining({ title: "Request #7 approved", body: expect.stringContaining("Upload the final content file") }),
    );
    expect(recalcConsenterScore).toHaveBeenCalledWith("jane", expect.any(String));
    // The owner's 80% is released on a yes, before anything can close it.
    expect(syncConsentPrice).toHaveBeenCalledWith("r1");
  });

  it("records narrower scope as conditions", async () => {
    request();
    const fewer = [{ ...selections[0], durationSec: 15 }];
    await approveAndIssue({ ...owner, conditionsNote: "  Credit Jane in the caption ", approvedSelections: fewer, approvedThumbnail: false });
    expect(h.state.request).toMatchObject({
      conditionsNote: "Credit Jane in the caption",
      approvedSelections: fewer,
      approvedThumbnail: false,
    });
    expect(h.state.events[0].type).toBe("approved_with_conditions");
    expect(notifyRequesterTeam).toHaveBeenCalledWith("acme-asks", expect.objectContaining({ title: "Request #7 approved with conditions" }));
  });

  it("can shorten the validity", async () => {
    request({ validUntil: new Date("2027-01-01T00:00:00Z") });
    const sooner = new Date("2026-12-01T00:00:00Z");
    await approveAndIssue({ ...owner, validUntil: sooner });
    expect(h.state.request!.validUntil).toEqual(sooner);
    expect(h.state.events[0].type).toBe("approved_with_conditions");
  });

  it("approves after a question was asked", async () => {
    request({ status: "CHANGES_REQUESTED" });
    await expect(approveAndIssue(owner)).resolves.toBe("APPROVED_IN_PRINCIPLE");
  });

  it("records an automatic yes against the rule", async () => {
    request({ status: "SUBMITTED" });
    await approveAndIssue({
      requestId: "r1",
      decidedById: null,
      decidedByName: "Standing rule (automatic)",
      actorSide: "system",
      ruleId: "rule1",
      ruleName: "News is fine",
    });
    expect(h.state.request).toMatchObject({ decidedById: null, decidedByRuleId: "rule1", decidedByRuleName: "News is fine" });
    expect(h.state.events[0]).toMatchObject({ type: "auto_approved", actorSide: "system", detail: { rule: "News is fine" } });
  });

  it("changes nothing on a request that is already approved", async () => {
    request({ status: "APPROVED_IN_PRINCIPLE" });
    await expect(approveAndIssue(owner)).resolves.toBe("APPROVED_IN_PRINCIPLE");
    expect(h.state.events).toHaveLength(0);
    expect(syncConsentPrice).not.toHaveBeenCalled();
  });

  it("refuses a request that has ended", async () => {
    for (const status of ["DENIED", "WITHDRAWN", "EXPIRED_NO_RESPONSE", "CLOSED", "DRAFT"]) {
      request({ status });
      await expect(approveAndIssue(owner)).rejects.toBeInstanceOf(ApprovalError);
    }
  });
});

describe("onRequestPaid", () => {
  it("sends a free request straight away and records that no fee was paid", async () => {
    request({ status: "DRAFT" });
    await expect(onRequestPaid("r1")).resolves.toBe("PENDING");
    expect(h.state.events[0]).toMatchObject({ type: "submitted", detail: { feePaid: false } });
    expect(h.state.request!.submittedAt).toBeInstanceOf(Date);
    expect(notifyConsenterTeam).toHaveBeenCalledWith("jane", expect.objectContaining({ title: "New consent request #7" }));
  });

  it("records a paid fee", async () => {
    request({ status: "DRAFT" });
    h.state.paidCount = 2;
    await onRequestPaid("r1");
    expect(h.state.events[0]).toMatchObject({ type: "submitted", detail: { feePaid: true } });
  });

  it("sends only a draft, once", async () => {
    request({ status: "PENDING" });
    await expect(onRequestPaid("r1")).resolves.toBeNull();
    expect(h.state.events).toHaveLength(0);
  });

  it("never sends a profile's request to itself", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    request({ status: "DRAFT", requester: { id: "jane-asks", consenterId: "jane", type: "INDIVIDUAL_CREATOR", score: 500, categories: [], displayName: "Jane Carter" } });
    await expect(onRequestPaid("r1")).resolves.toBeNull();
    expect(h.state.request!.status).toBe("DRAFT");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("approves through the same path when the owner's terms allow it", async () => {
    request({ status: "DRAFT", files: [{ kind: "RAW_CONTENT" }] });
    vi.mocked(evaluateAutoDecision).mockResolvedValueOnce({
      kind: "rule",
      action: "AUTO_APPROVE",
      ruleId: "rule1",
      ruleName: "News is fine",
      createdByName: "Jane Carter",
      createdAt: new Date("2026-10-01T00:00:00Z"),
    });
    await expect(onRequestPaid("r1")).resolves.toBe("APPROVED");
    expect(h.state.request!.decidedByRuleName).toBe("News is fine (set by Jane Carter on 2026-10-01)");
    expect(issueGrant).toHaveBeenCalledWith("r1", "Standing rule (automatic)");
    expect(syncConsentPrice).toHaveBeenCalledWith("r1");
  });

  it("gives standing rules the Consent Score people see, not the sending half's alone", async () => {
    request({
      status: "DRAFT",
      requester: { id: "acme-asks", consenterId: "acme", type: "MEDIA_HOUSE", score: 500, categories: [], displayName: "Acme Clips", consenter: { score: 900 } },
    });
    await onRequestPaid("r1");
    expect(evaluateAutoDecision).toHaveBeenCalledWith(
      expect.objectContaining({ requester: expect.objectContaining({ id: "acme-asks", score: 700 }) }),
    );
  });

  it("declines when the owner's terms never allow it", async () => {
    request({ status: "DRAFT" });
    vi.mocked(evaluateAutoDecision).mockResolvedValueOnce({ kind: "matrix", policy: "AUTO_DENY" });
    await expect(onRequestPaid("r1")).resolves.toBe("DENIED");
    expect(h.state.request).toMatchObject({ status: "DENIED", denialReason: "Jane Carter never allows this platform, format and asset combination." });
    expect(syncConsentPrice).toHaveBeenCalledWith("r1");
    expect(notifyRequesterTeam).toHaveBeenCalledWith("acme-asks", expect.objectContaining({ body: "Jane Carter never allows this combination." }));
  });
});

describe("askerScore", () => {
  it("is the average of the profile's two halves, as shown everywhere", () => {
    expect(askerScore({ score: 500, consenter: { score: 900 } })).toBe(700);
    expect(askerScore({ score: 501, consenter: { score: 900 } })).toBe(701);
  });

  it("is the sending half's own score when it has no paired profile", () => {
    expect(askerScore({ score: 640, consenter: null })).toBe(640);
    expect(askerScore({ score: 640 })).toBe(640);
  });
});
