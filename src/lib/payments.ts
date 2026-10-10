/* Money in: what someone pays to send a request, the yearly membership, and
   what happens once a payment goes through.

   A request with a consent request fee is paid in ONE provider checkout, in
   the fee's currency: the consent request fee (held until the person asked
   answers, 80/20) plus Consent's platform fee (20% of that fee, never
   refunded), plus tax on the platform fee when the payer's country has one.
   It is stored as two lines that share the checkout's providerRef, so a
   refund can find the charge. A free request has no lines and no checkout.
   The membership (the same for every profile) is charged only while the
   admin has the membership fee switched on. */

import { db } from "./db";
import { paymentProviderFor } from "./providers";
import type { Payment, PaymentPurpose } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { syncConsentPrice, splitConsentFee } from "./escrow";
import { requestCharges } from "./platform-fee";

export async function priceFor(country: string) {
  const row =
    (await db.priceConfig.findUnique({ where: { country } })) ??
    (await db.priceConfig.findUnique({ where: { country: "DEFAULT" } }));
  if (!row) throw new Error("No pricing configured");
  return row;
}

/** The tax the payer's country adds to Consent's own fees. None when no price row exists. */
async function taxFor(country: string) {
  const row =
    (await db.priceConfig.findUnique({ where: { country } })) ??
    (await db.priceConfig.findUnique({ where: { country: "DEFAULT" } }));
  return { taxRate: row?.taxRate ?? null, taxLabel: row?.taxLabel ?? null };
}

/** Adds tax the same way checkout does, so a price shown before paying matches the charge. */
export function withTax(amount: number, taxRate: { toString(): string } | null | undefined) {
  const tax = taxRate ? cents((amount * Number(taxRate)) / 100) : 0;
  return { tax, total: cents(amount + tax) };
}

const cents = (n: number) => Math.round(n * 100) / 100;
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

/**
 * The consent request fee for an intent: a per-intent fee wins over the
 * profile's fee (e.g. News free, Promotion ₹2,500). Null when asking is free.
 */
export function consentPriceFor<T extends { toString(): string }>(
  consenter: { consentPrice: T | null; priceTiers: { intentCategoryId: string; amount: T }[] },
  intentCategoryId: string | null | undefined
): T | null {
  const tier = intentCategoryId
    ? consenter.priceTiers.find((t) => t.intentCategoryId === intentCategoryId)
    : undefined;
  const ask = tier ? tier.amount : consenter.consentPrice;
  return ask != null && Number(ask) > 0 ? ask : null;
}

/** True while a coupon can still be redeemed: switched on, not expired, uses left. */
export function couponOpen(
  coupon: { active: boolean; expiresAt: Date | null; maxUses: number | null; usedCount: number } | null
) {
  return (
    !!coupon &&
    coupon.active &&
    (!coupon.expiresAt || coupon.expiresAt > new Date()) &&
    (coupon.maxUses == null || coupon.usedCount < coupon.maxUses)
  );
}

/** An open coupon for a typed code, or null. */
async function openCoupon(code: string | null | undefined) {
  const clean = code?.trim().toUpperCase();
  if (!clean) return null;
  const coupon = await db.coupon.findUnique({ where: { code: clean } });
  return coupon && couponOpen(coupon) ? coupon : null;
}

/** What the provider's checkout says the charge is for. */
const CHECKOUT_DESCRIPTION: Record<PaymentPurpose, string> = {
  MEMBERSHIP: "Consent membership, one year",
  PER_REQUEST: "Consent platform fee",
  CONSENT_PRICE: "Consent request fee",
};

// ── Requests ──────────────────────────────────────────────────

/** What sending a request costs, shown before paying. All in the consent request fee's currency. */
export type RequestCharges = {
  /** Nothing to pay: the request is sent without a checkout. */
  free: boolean;
  currency: string;
  /** The consent request fee (0 when free). */
  consentFee: number;
  /** The platform fee: 20% of the consent request fee, after any coupon, before tax. */
  platformFee: number;
  /** Tax on the platform fee, by the payer's country. */
  tax: number;
  taxLabel: string | null;
  /** Everything together: one charge. */
  total: number;
};

type PricedRequest = {
  intentCategoryId: string | null;
  consenter: {
    consentPrice: Prisma.Decimal | null;
    consentPriceCurrency: string;
    priceTiers: { intentCategoryId: string; amount: Prisma.Decimal }[];
  };
  requester: { country: string };
};

const REQUEST_INCLUDE = {
  consenter: { include: { priceTiers: true } },
  requester: true,
} as const;

/** The charges for a request as checkout builds them, with the coupon split out. */
async function chargesFor(request: PricedRequest, percentOff?: number | null) {
  const currency = request.consenter.consentPriceCurrency;
  const ask = consentPriceFor(request.consenter, request.intentCategoryId);
  if (!ask) {
    return { free: true, currency, consentFee: 0, platformFee: 0, discount: 0, tax: 0, taxLabel: null, platformTotal: 0, total: 0 };
  }
  const { taxRate, taxLabel } = await taxFor(request.requester.country);
  const c = requestCharges(ask, { percentOff, taxRate });
  return {
    free: false,
    currency,
    consentFee: c.consentFee,
    platformFee: cents(c.platformFee - c.discount),
    discount: c.discount,
    tax: c.tax,
    taxLabel: c.tax ? (taxLabel ?? "Tax") : null,
    platformTotal: c.platformTotal,
    total: c.total,
  };
}

/** What the asker will pay to send this request, worked out exactly as checkout charges it. */
export async function requestChargesFor(requestId: string): Promise<RequestCharges> {
  const request = await db.consentRequest.findUniqueOrThrow({ where: { id: requestId }, include: REQUEST_INCLUDE });
  const c = await chargesFor(request);
  return {
    free: c.free,
    currency: c.currency,
    consentFee: c.consentFee,
    platformFee: c.platformFee,
    tax: c.tax,
    taxLabel: c.taxLabel,
    total: c.total,
  };
}

type PlannedLine = { purpose: "CONSENT_PRICE" | "PER_REQUEST"; amount: number };

/**
 * The lines a checkout for this request charges: the consent request fee and
 * the platform fee, less any already paid (a checkout that went through only
 * in part is never charged twice). None when asking is free.
 */
async function plannedLines(request: PricedRequest & { id: string }, percentOff?: number | null) {
  const c = await chargesFor(request, percentOff);
  if (c.free) return { c, lines: [] as PlannedLine[] };
  const paid = await db.payment.findMany({ where: { requestId: request.id, status: "PAID" }, select: { purpose: true } });
  const done = new Set(paid.map((p) => p.purpose));
  const lines: PlannedLine[] = [];
  if (!done.has("CONSENT_PRICE")) lines.push({ purpose: "CONSENT_PRICE", amount: c.consentFee });
  if (!done.has("PER_REQUEST")) lines.push({ purpose: "PER_REQUEST", amount: c.platformTotal });
  return { c, lines };
}

/** A line was paid between reading it and bringing it up to date. */
class CheckoutJustPaid extends Error {
  constructor() {
    super("This checkout was just paid.");
  }
}

/**
 * Starts paying for a draft. Free to ask: any unpaid lines are dropped and
 * nothing is charged (the caller sends it with onRequestPaid). Otherwise the
 * consent request fee and platform fee lines are written (an abandoned
 * checkout's lines are reused and brought up to date, extra ones dropped) and
 * one provider checkout covers both.
 */
export async function startRequestCheckout(opts: {
  requesterId: string;
  requestId: string;
  returnTo: string;
  /** Optional: a coupon takes its percentage off the platform fee only. */
  couponCode?: string | null;
}, retried = false): Promise<{ free: true } | { free: false; checkoutUrl: string }> {
  const request = await db.consentRequest.findUniqueOrThrow({ where: { id: opts.requestId }, include: REQUEST_INCLUDE });
  if (request.requesterId !== opts.requesterId) throw new Error("This request belongs to another profile.");
  const pending = await db.payment.findMany({
    where: { requestId: request.id, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  const coupon = await openCoupon(opts.couponCode);
  const { c, lines } = await plannedLines(request, coupon?.percentOff);

  if (lines.length === 0) {
    if (pending.length) {
      await db.payment.deleteMany({ where: { id: { in: pending.map((p) => p.id) }, status: "PENDING" } });
    }
    return { free: true };
  }

  const provider = paymentProviderFor(request.requester.country);
  const base = { requesterId: request.requesterId, requestId: request.id, currency: c.currency, provider: provider.name, providerRef: null };
  const dataFor = (line: PlannedLine) =>
    line.purpose === "CONSENT_PRICE"
      ? { ...base, purpose: line.purpose, amount: dec(line.amount), couponCode: null, discount: null, tax: null, taxLabel: null }
      : {
          ...base,
          purpose: line.purpose,
          amount: dec(line.amount),
          couponCode: coupon && c.discount ? coupon.code : null, // counted as used only once paid
          discount: c.discount ? dec(c.discount) : null,
          tax: c.tax ? dec(c.tax) : null,
          taxLabel: c.taxLabel,
        };
  // Reuse the newest unpaid line of each kind (an open checkout link keeps working); drop the rest.
  const keep = new Map(lines.map((l) => [l.purpose, pending.find((p) => p.purpose === l.purpose)]));
  const drop = pending.filter((p) => keep.get(p.purpose as PlannedLine["purpose"]) !== p).map((p) => p.id);
  let rows: Payment[];
  try {
    rows = await db.$transaction(async (tx) => {
      if (drop.length) await tx.payment.deleteMany({ where: { id: { in: drop }, status: "PENDING" } });
      const out: Payment[] = [];
      for (const line of lines) {
        const existing = keep.get(line.purpose);
        if (!existing) {
          out.push(await tx.payment.create({ data: dataFor(line) }));
          continue;
        }
        // Only an unpaid line is brought up to date. A line paid in another tab
        // since it was read keeps its amount, coupon, tax and providerRef, so
        // its invoice and any refund still match the real charge.
        const moved = await tx.payment.updateMany({ where: { id: existing.id, status: "PENDING" }, data: dataFor(line) });
        if (moved.count === 0) throw new CheckoutJustPaid();
        out.push(await tx.payment.findUniqueOrThrow({ where: { id: existing.id } }));
      }
      return out;
    });
  } catch (e) {
    // Plan again once: the line just paid is then left out (never charged twice).
    if (e instanceof CheckoutJustPaid && !retried) return startRequestCheckout(opts, true);
    throw e;
  }

  const total = cents(lines.reduce((sum, l) => sum + l.amount, 0));
  const { checkoutUrl, providerRef } = await provider.createCheckout({
    paymentId: rows[0].id,
    amount: total.toFixed(2),
    currency: c.currency,
    description: `${lines.map((l) => CHECKOUT_DESCRIPTION[l.purpose]).join(" and ")}, request #${request.number}`,
    returnTo: opts.returnTo,
  });
  // The lines are one charge: a refund of the consent request fee finds it by this ref.
  await db.payment.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { providerRef } });
  return { free: false, checkoutUrl };
}

/**
 * True when the unpaid lines of a draft no longer match what sending it
 * would charge now (the intent, the fee, its currency or the tax changed, or
 * asking became free). Checkout must then be started again.
 */
export async function checkoutIsStale(requestId: string): Promise<boolean> {
  const request = await db.consentRequest.findUnique({ where: { id: requestId }, include: REQUEST_INCLUDE });
  if (!request) return true;
  const pending = await db.payment.findMany({ where: { requestId, status: "PENDING" } });
  const code = pending.find((l) => l.purpose === "PER_REQUEST")?.couponCode;
  const coupon = code ? await db.coupon.findUnique({ where: { code } }) : null;
  const { c, lines } = await plannedLines(request, coupon?.percentOff);
  if (pending.length !== lines.length) return true;
  return lines.some((line) => {
    const rows = pending.filter((p) => p.purpose === line.purpose);
    return rows.length !== 1 || rows[0].currency !== c.currency || !rows[0].amount.eq(line.amount.toFixed(2));
  });
}

// ── Membership ────────────────────────────────────────────────

/**
 * The yearly membership price for a payer's country: its price row, else
 * DEFAULT, else ₹1,000 while no prices are set up. Tax is added on top.
 */
export async function membershipPriceFor(country: string) {
  const row = await priceFor(country).catch(() => null);
  return row
    ? { fee: Number(row.membershipFee.toString()), currency: row.currency, taxRate: row.taxRate, taxLabel: row.taxLabel }
    : { fee: 1000, currency: "INR", taxRate: null, taxLabel: null };
}

/**
 * Starts paying for one year of membership (only offered while the admin has
 * the membership fee on). An unpaid membership line is reused.
 */
export async function startMembershipCheckout(opts: {
  requesterId: string;
  returnTo: string;
  /** Optional: a coupon takes its percentage off the membership. */
  couponCode?: string | null;
}): Promise<{ checkoutUrl: string }> {
  const requester = await db.requesterProfile.findUniqueOrThrow({ where: { id: opts.requesterId } });
  const price = await membershipPriceFor(requester.country);
  const coupon = await openCoupon(opts.couponCode);
  const fee = price.fee;
  const discount = coupon ? cents((fee * coupon.percentOff) / 100) : 0;
  const { tax, total } = withTax(cents(fee - discount), price.taxRate);
  const provider = paymentProviderFor(requester.country);
  const data = {
    requesterId: requester.id,
    purpose: "MEMBERSHIP" as const,
    amount: dec(total),
    currency: price.currency,
    provider: provider.name,
    providerRef: null,
    couponCode: coupon && discount ? coupon.code : null,
    discount: discount ? dec(discount) : null,
    tax: tax ? dec(tax) : null,
    taxLabel: tax ? (price.taxLabel ?? "Tax") : null,
  };
  const [unpaid, ...dupes] = await db.payment.findMany({
    where: { requesterId: requester.id, purpose: "MEMBERSHIP", status: "PENDING", requestId: null },
    orderBy: { createdAt: "desc" },
  });
  if (dupes.length) await db.payment.deleteMany({ where: { id: { in: dupes.map((p) => p.id) }, status: "PENDING" } });
  const payment = unpaid
    ? await db.payment.update({ where: { id: unpaid.id }, data })
    : await db.payment.create({ data });
  const { checkoutUrl, providerRef } = await provider.createCheckout({
    paymentId: payment.id,
    amount: total.toFixed(2),
    currency: price.currency,
    description: CHECKOUT_DESCRIPTION.MEMBERSHIP,
    returnTo: opts.returnTo,
  });
  await db.payment.update({ where: { id: payment.id }, data: { providerRef } });
  return { checkoutUrl };
}

// ── Who can see and pay ───────────────────────────────────────

/**
 * This person's role on the profile that pays (its sending half, or the
 * profile it belongs to), or null when they aren't on it. Viewers can see
 * payments and invoices but not pay.
 */
export async function payerRole(
  requester: { id: string; consenterId: string | null },
  userId: string,
): Promise<"OWNER" | "MANAGER" | "EDITOR" | "VIEWER" | null> {
  const seat = await db.requesterMember.findUnique({
    where: { requesterId_userId: { requesterId: requester.id, userId } },
    select: { role: true },
  });
  if (seat) return seat.role;
  if (!requester.consenterId) return null;
  const member = await db.consenterMember.findUnique({
    where: { consenterId_userId: { consenterId: requester.consenterId, userId } },
    select: { role: true },
  });
  return member?.role ?? null;
}

// ── After paying ──────────────────────────────────────────────

/**
 * The unpaid lines one checkout covers: those sharing its providerRef (a
 * request's consent request fee and platform fee), else just this one.
 */
export async function checkoutLines(payment: Pick<Payment, "id" | "providerRef" | "requestId">) {
  if (!payment.providerRef) return db.payment.findMany({ where: { id: payment.id, status: "PENDING" } });
  return db.payment.findMany({
    where: {
      status: "PENDING",
      OR: [{ id: payment.id }, { providerRef: payment.providerRef, requestId: payment.requestId }],
    },
    orderBy: { purpose: "asc" },
  });
}

/**
 * Settles every unpaid line of a checkout, the consent request fee first so
 * its held earning exists before the request is sent and decided. Returns
 * the lines it settled.
 */
export async function settleCheckout(paymentId: string) {
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const lines = await checkoutLines(payment);
  const order = (p: Payment) => (p.purpose === "CONSENT_PRICE" ? 0 : 1);
  const settled: Payment[] = [];
  for (const line of [...lines].sort((a, b) => order(a) - order(b))) settled.push(await settlePayment(line.id));
  return settled;
}

/** Marks a payment paid and applies its side effects. Idempotent. */
export async function settlePayment(paymentId: string) {
  const { onRequestPaid } = await import("./requests");
  const now = new Date();
  const invoiceNumber = `INV-${now.getFullYear()}-${String(now.getTime()).slice(-8)}-${paymentId.slice(-4).toUpperCase()}`;
  // Only an unpaid line moves, and only once, even if two confirmations race.
  const moved = await db.payment.updateMany({
    where: { id: paymentId, status: { in: ["PENDING", "FAILED"] } },
    data: { status: "PAID", paidAt: now, invoiceNumber },
  });
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (moved.count === 0) return payment;

  // A coupon is used up only by a completed payment, never by an abandoned
  // checkout. Checkout re-checks it before paying; the count never passes maxUses.
  if (payment.couponCode) {
    await db.coupon.updateMany({
      where: {
        code: payment.couponCode,
        OR: [{ maxUses: null }, { usedCount: { lt: db.coupon.fields.maxUses } }],
      },
      data: { usedCount: { increment: 1 } },
    });
  }

  if (payment.purpose === "MEMBERSHIP") {
    // One more year, from today or from the current end if it is still ahead.
    const r = await db.requesterProfile.findUniqueOrThrow({ where: { id: payment.requesterId } });
    const next = new Date(r.membershipEndsAt && r.membershipEndsAt > now ? r.membershipEndsAt : now);
    next.setFullYear(next.getFullYear() + 1);
    await db.requesterProfile.update({ where: { id: payment.requesterId }, data: { membershipEndsAt: next } });
  } else if (payment.purpose === "PER_REQUEST" && payment.requestId) {
    await onRequestPaid(payment.requestId);
  } else if (payment.purpose === "CONSENT_PRICE" && payment.requestId) {
    // Held for the profile asked until they answer: 80% is theirs on a yes,
    // paid out in the weekly settlement; 80% is refunded otherwise.
    const request = await db.consentRequest.findUnique({ where: { id: payment.requestId } });
    if (request) {
      await db.earningEntry.upsert({
        where: { paymentId: payment.id },
        update: {},
        create: {
          consenterId: request.consenterId,
          requestId: payment.requestId,
          paymentId: payment.id,
          amount: splitConsentFee(Number(payment.amount.toString())).owner.toFixed(2),
          grossAmount: payment.amount,
          currency: payment.currency,
        },
      });
    }
  }
  // If the request already has an answer (decided automatically on sending),
  // settle the held fee now.
  if (payment.requestId) await syncConsentPrice(payment.requestId);
  return payment;
}
