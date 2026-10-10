import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/* Checkout and settlement (src/lib/payments.ts) against a small in-memory
   stand-in for the database: which lines a request is charged, in which
   currency, how stale lines are replaced, and what paying does. */

type Row = Record<string, unknown> & { id: string };

const h = vi.hoisted(() => {
  const state = {
    payments: [] as Row[],
    requests: [] as Row[],
    requesters: [] as Row[],
    prices: [] as Row[],
    coupons: [] as Row[],
    earnings: [] as Row[],
    nextId: 1,
  };

  // A tiny Prisma-style "where": equality, null, { in }, { not }, OR.
  function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, cond]) => {
      if (k === "OR") return (cond as Record<string, unknown>[]).some((w) => matches(row, w));
      const v = row[k];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date) && !("toFixed" in (cond as object))) {
        const c = cond as { in?: unknown[]; not?: unknown };
        if (c.in) return c.in.includes(v);
        if ("not" in c) return v !== c.not;
      }
      return cond === null ? v == null : v === cond;
    });
  }
  const table = (rows: () => Row[]) => ({
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => rows().filter((r) => matches(r, where)),
    findUnique: async ({ where }: { where: Record<string, unknown> }) => rows().find((r) => matches(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => {
      const r = rows().find((x) => matches(x, where));
      if (!r) throw new Error("not found");
      return r;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const r = { id: `p${state.nextId++}`, status: "PENDING", createdAt: new Date(Date.now() + state.nextId), ...data } as Row;
      rows().push(r);
      return r;
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const r = rows().find((x) => x.id === where.id)!;
      Object.assign(r, data);
      return r;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const keep = rows().filter((r) => !matches(r, where));
      const count = rows().length - keep.length;
      rows().splice(0, rows().length, ...keep);
      return { count };
    },
  });

  const payment = table(() => state.payments);
  const db = {
    payment,
    priceConfig: table(() => state.prices),
    coupon: { ...table(() => state.coupons), fields: { maxUses: "maxUses" } },
    requesterProfile: table(() => state.requesters),
    earningEntry: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        const r = { id: `e${state.nextId++}`, status: "HELD", ...create } as Row;
        state.earnings.push(r);
        return r;
      },
    },
    consentRequest: {
      // The request with its consenter (and price tiers) and requester, as included.
      findUnique: async ({ where }: { where: { id: string } }) => state.requests.find((r) => r.id === where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const r = state.requests.find((x) => x.id === where.id);
        if (!r) throw new Error("not found");
        return r;
      },
    },
    $transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  const onRequestPaid = vi.fn(async (id: string) => {
    const r = state.requests.find((x) => x.id === id)!;
    r.status = "PENDING";
    return "PENDING";
  });
  const syncConsentPrice = vi.fn(async () => "hold");
  return { state, db, onRequestPaid, syncConsentPrice };
});

vi.mock("../../../lib/db", () => ({ db: h.db }));
vi.mock("../../../lib/requests", () => ({ onRequestPaid: h.onRequestPaid }));
vi.mock("../../../lib/escrow", () => ({
  syncConsentPrice: h.syncConsentPrice,
  splitConsentFee: (gross: number) => ({ owner: Math.round(gross * 80) / 100, refund: Math.round(gross * 80) / 100 }),
}));

import {
  startRequestCheckout,
  requestChargesFor,
  checkoutIsStale,
  settleCheckout,
  startMembershipCheckout,
  settlePayment,
} from "../../../lib/payments";

const D = (v: string | number) => new Prisma.Decimal(v);

function request(fee: string | null, tiers: { intentCategoryId: string; amount: string }[] = []) {
  const r: Row = {
    id: "r1",
    number: 7,
    status: "DRAFT",
    requesterId: "asker",
    consenterId: "owner",
    intentCategoryId: "news",
    consenter: {
      consentPrice: fee == null ? null : D(fee),
      consentPriceCurrency: "INR",
      priceTiers: tiers.map((t) => ({ ...t, amount: D(t.amount) })),
    },
    requester: { id: "asker", country: "IN" },
  };
  h.state.requests = [r];
  return r;
}

const pending = () => h.state.payments.filter((p) => p.status === "PENDING");

beforeEach(() => {
  h.state.payments = [];
  h.state.earnings = [];
  h.state.coupons = [];
  h.state.nextId = 1;
  h.state.requesters = [{ id: "asker", country: "IN", membershipEndsAt: null }];
  h.state.prices = [{ id: "pc", country: "IN", currency: "INR", membershipFee: D(1000), taxLabel: "GST", taxRate: D(18) }];
  h.onRequestPaid.mockClear();
  h.syncConsentPrice.mockClear();
});

describe("request checkout", () => {
  it("charges nothing when asking is free, and drops lines left from before", async () => {
    request(null);
    h.state.payments.push({ id: "old", requestId: "r1", purpose: "PER_REQUEST", status: "PENDING", amount: D(9), currency: "USD" });
    expect(await requestChargesFor("r1")).toEqual({ free: true, currency: "INR", consentFee: 0, platformFee: 0, tax: 0, taxLabel: null, total: 0 });
    expect(await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" })).toEqual({ free: true });
    expect(h.state.payments).toHaveLength(0);
  });

  it("is free for a kind of consent set to free, even when the profile has a fee", async () => {
    request("500", [{ intentCategoryId: "news", amount: "0" }]);
    expect((await requestChargesFor("r1")).free).toBe(true);
  });

  it("charges the fee, the 20% platform fee and tax on the platform fee, in one checkout and one currency", async () => {
    request("100");
    expect(await requestChargesFor("r1")).toEqual({
      free: false,
      currency: "INR",
      consentFee: 100,
      platformFee: 20,
      tax: 3.6,
      taxLabel: "GST",
      total: 123.6,
    });
    const out = await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/r-panel/requests/r1?submitted=1" });
    expect(out.free).toBe(false);
    const lines = pending();
    expect(lines.map((l) => [l.purpose, String(l.amount), l.currency])).toEqual([
      ["CONSENT_PRICE", "100", "INR"],
      ["PER_REQUEST", "23.6", "INR"],
    ]);
    // One charge: both lines carry the checkout's ref, and the URL opens it.
    expect(new Set(lines.map((l) => l.providerRef)).size).toBe(1);
    expect(lines[0].providerRef).toBeTruthy();
    expect(out.free === false && out.checkoutUrl).toContain(`/pay/mock/${lines[0].id}`);
    expect(String(lines[1].tax)).toBe("3.6");
    expect(await checkoutIsStale("r1")).toBe(false);
  });

  it("reuses an abandoned checkout's lines, brought up to date, and drops extra ones", async () => {
    const r = request("100");
    await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" });
    const firstIds = pending().map((l) => l.id);
    h.state.payments.push({ id: "dupe", requestId: "r1", purpose: "CONSENT_PRICE", status: "PENDING", amount: D(100), currency: "INR", createdAt: new Date(0) });
    (r.consenter as { consentPrice: Prisma.Decimal }).consentPrice = D(250);
    expect(await checkoutIsStale("r1")).toBe(true);
    await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" });
    const lines = pending();
    expect(lines.map((l) => l.id).sort()).toEqual([...firstIds].sort());
    expect(lines.map((l) => String(l.amount))).toEqual(["250", "59"]);
    expect(await checkoutIsStale("r1")).toBe(false);
  });

  it("never charges a line twice when a checkout went through only in part", async () => {
    request("100");
    h.state.payments.push({ id: "paid", requestId: "r1", purpose: "CONSENT_PRICE", status: "PAID", amount: D(100), currency: "INR" });
    await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" });
    expect(pending().map((l) => l.purpose)).toEqual(["PER_REQUEST"]);
  });

  it("never rewrites a line paid in another tab while Send is pressed again", async () => {
    request("100");
    await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" });
    const before = h.state.payments.map((p) => ({ ...p }));
    // Send reads the unpaid lines, then Pay in another tab settles them before they are rewritten.
    const findMany = h.db.payment.findMany;
    h.db.payment.findMany = async (args) => {
      h.db.payment.findMany = findMany;
      const rows = (await findMany(args)).map((r) => ({ ...r }));
      h.state.payments.forEach((p) => (p.status = "PAID"));
      return rows;
    };
    expect(await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" })).toEqual({ free: true });
    expect(h.state.payments.map((p) => [p.id, String(p.amount), p.providerRef, p.tax])).toEqual(
      before.map((p) => [p.id, String(p.amount), p.providerRef, p.tax]),
    );
  });

  it("refuses a request of another profile", async () => {
    request("100");
    await expect(startRequestCheckout({ requesterId: "someone", requestId: "r1", returnTo: "/x" })).rejects.toThrow();
  });

  it("settles the fee first (held for the person asked), then the platform fee sends the request", async () => {
    request("100");
    await startRequestCheckout({ requesterId: "asker", requestId: "r1", returnTo: "/x" });
    const order: string[] = [];
    h.onRequestPaid.mockImplementationOnce(async () => {
      order.push(`sent after ${h.state.earnings.length} held fee`);
      return "PENDING";
    });
    const settled = await settleCheckout(pending()[1].id);
    expect(settled.map((p) => p.purpose)).toEqual(["CONSENT_PRICE", "PER_REQUEST"]);
    expect(order).toEqual(["sent after 1 held fee"]);
    expect(h.state.earnings[0]).toMatchObject({ consenterId: "owner", requestId: "r1", amount: "80.00", currency: "INR", status: "HELD" });
    expect(h.state.payments.every((p) => p.status === "PAID" && p.invoiceNumber)).toBe(true);
    // Paying again changes nothing.
    await settleCheckout(settled[0].id);
    expect(h.onRequestPaid).toHaveBeenCalledTimes(1);
  });
});

describe("membership", () => {
  it("charges a year with tax and, once paid, extends from today or the current end", async () => {
    const { checkoutUrl } = await startMembershipCheckout({ requesterId: "asker", returnTo: "/r-panel/billing?renewed=1" });
    const [line] = pending();
    expect([line.purpose, String(line.amount), line.currency, String(line.tax)]).toEqual(["MEMBERSHIP", "1180", "INR", "180"]);
    expect(checkoutUrl).toContain(`/pay/mock/${line.id}`);

    const before = Date.now();
    await settlePayment(line.id);
    const end = h.state.requesters[0].membershipEndsAt as Date;
    expect(end.getTime()).toBeGreaterThan(before + 364 * 86400_000);

    await startMembershipCheckout({ requesterId: "asker", returnTo: "/x" });
    await settlePayment(pending()[0].id);
    const renewed = h.state.requesters[0].membershipEndsAt as Date;
    expect(renewed.getFullYear()).toBe(end.getFullYear() + 1);
  });
});
