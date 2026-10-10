import { describe, it, expect, vi, beforeEach } from "vitest";

/* issueGrant against a small in-memory stand-in for the database: only an
   approved request gets a certificate, and two racing calls end with one. */

const h = vi.hoisted(() => {
  const state = {
    request: null as null | Record<string, unknown> & { status: string; grant: unknown },
    grant: null as null | { id: string; requestId: string },
    events: [] as { type: string }[],
    /** Simulates another call creating the grant between the read and the write. */
    raceCreate: false,
  };
  const tx = {
    consentRequest: {
      updateMany: vi.fn(async ({ where, data }: { where: { status: { in: string[] } }; data: { status: string } }) => {
        const r = state.request!;
        if (!where.status.in.includes(r.status)) return { count: 0 };
        r.status = data.status;
        return { count: 1 };
      }),
    },
    grant: {
      create: vi.fn(async ({ data }: { data: { requestId: string } }) => {
        if (state.raceCreate) {
          state.grant = { id: "g-first", requestId: data.requestId };
          throw Object.assign(new Error("Unique constraint failed on the fields: (`requestId`)"), { code: "P2002" });
        }
        state.grant = { id: "g-new", requestId: data.requestId };
        return state.grant;
      }),
    },
    storedFile: { updateMany: vi.fn(async () => ({ count: 1 })) },
    requestEvent: {
      create: vi.fn(async ({ data }: { data: { type: string } }) => {
        state.events.push(data);
        return data;
      }),
    },
  };
  const db = {
    consentRequest: { findUniqueOrThrow: vi.fn(async () => state.request) },
    grant: { findUniqueOrThrow: vi.fn(async () => state.grant) },
    // Rolls back the in-memory request when the callback throws, like a real transaction.
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const before = state.request!.status;
      const events = state.events.length;
      try {
        return await fn(tx);
      } catch (e) {
        state.request!.status = before;
        state.events.length = events;
        throw e;
      }
    }),
  };
  return { state, db, tx };
});

vi.mock("../db", () => ({ db: h.db }));
vi.mock("../signing", () => ({ signPayload: vi.fn(async () => ({ signature: "sig", publicKey: "pk" })) }));
vi.mock("../notify", () => ({ notifyConsenterTeam: vi.fn(), notifyRequesterTeam: vi.fn() }));
vi.mock("../score", () => ({ recalcConsenterScore: vi.fn(), recalcRequesterScore: vi.fn() }));

import { GrantError, issueGrant } from "../grants";
import { notifyRequesterTeam } from "../notify";

function request(status: string, grant: unknown = null) {
  h.state.request = {
    id: "r1",
    number: 7,
    status,
    grant,
    consenterId: "jane",
    requesterId: "acme-asks",
    consenter: { legalName: "Jane Carter", displayName: "Jane Carter" },
    requester: { legalName: "Acme Clips Ltd", displayName: "Acme Clips" },
    files: [{ id: "f1", kind: "RAW_CONTENT", name: "cut.mp4", sha256: "abc", version: 1, createdAt: new Date("2026-10-01") }],
    decidedBy: null,
    decidedAt: new Date("2026-10-02"),
    decidedByRuleId: null,
    decidedByRuleName: null,
    selections: [],
    approvedSelections: null,
    assetTypeNames: ["Name"],
    thumbnailUsed: false,
    approvedThumbnail: null,
    conditionsNote: null,
    intentCategoryName: null,
    validityKind: "PERPETUAL",
    validFrom: null,
    validUntil: null,
  };
  h.state.grant = null;
  h.state.events = [];
  h.state.raceCreate = false;
}

beforeEach(() => vi.clearAllMocks());

describe("issueGrant", () => {
  it("issues the certificate for a yes waiting for the final file", async () => {
    request("APPROVED_IN_PRINCIPLE");
    await expect(issueGrant("r1", "Jane Carter")).resolves.toMatchObject({ id: "g-new" });
    expect(h.state.request!.status).toBe("APPROVED");
    expect(h.state.events.map((e) => e.type)).toEqual(["grant_issued"]);
    expect(notifyRequesterTeam).toHaveBeenCalledOnce();
  });

  it("returns the existing grant and changes nothing", async () => {
    request("APPROVED", { id: "g-old" });
    await expect(issueGrant("r1")).resolves.toEqual({ id: "g-old" });
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a request that is no longer approved", async () => {
    for (const status of ["CLOSED", "WITHDRAWN", "DENIED", "PENDING"]) {
      request(status);
      await expect(issueGrant("r1")).rejects.toBeInstanceOf(GrantError);
      expect(h.state.request!.status).toBe(status);
      expect(h.tx.grant.create).not.toHaveBeenCalled();
    }
  });

  it("leaves a request closed in the meantime as it is, with no grant", async () => {
    request("CLOSED");
    // Read while still approved; closed (by an admin) before the write.
    h.db.consentRequest.findUniqueOrThrow.mockImplementationOnce(async () => ({ ...h.state.request!, status: "APPROVED_IN_PRINCIPLE" }));
    await expect(issueGrant("r1")).rejects.toBeInstanceOf(GrantError);
    expect(h.state.request!.status).toBe("CLOSED");
    expect(h.tx.grant.create).not.toHaveBeenCalled();
    expect(notifyRequesterTeam).not.toHaveBeenCalled();
  });

  it("returns the first call's grant when two calls issue at once", async () => {
    request("APPROVED_IN_PRINCIPLE");
    h.state.raceCreate = true;
    await expect(issueGrant("r1")).resolves.toEqual({ id: "g-first", requestId: "r1" });
    // The losing call wrote nothing and told nobody; the winner already did.
    expect(h.state.events).toHaveLength(0);
    expect(notifyRequesterTeam).not.toHaveBeenCalled();
  });
});
