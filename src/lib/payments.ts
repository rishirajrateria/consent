import { db } from "./db";
import { paymentProviderFor } from "./providers";
import type { PaymentPurpose } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { syncConsentPrice, splitConsentFee } from "./escrow";

export async function priceFor(country: string) {
  const row =
    (await db.priceConfig.findUnique({ where: { country } })) ??
    (await db.priceConfig.findUnique({ where: { country: "DEFAULT" } }));
  if (!row) throw new Error("No pricing configured");
  return row;
}

/** Adds tax the same way checkout does, so a price shown before paying matches the charge. */
export function withTax(amount: number, taxRate: { toString(): string } | null | undefined) {
  const tax = taxRate ? (amount * Number(taxRate)) / 100 : 0;
  return { tax, total: amount + tax };
}

/**
 * The owner's consent request fee for an intent: a per-intent tier wins over the
 * base price (e.g. News free, Promotion $250). Null when asking is free.
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

/** What the provider's checkout says the charge is for. */
const CHECKOUT_DESCRIPTION: Record<PaymentPurpose, string> = {
  ONBOARDING: "Consent onboarding fee",
  SUBSCRIPTION: "Consent yearly subscription",
  PER_REQUEST: "Consent platform fee",
  CONSENT_PRICE: "Consent request fee",
};

/** Creates a platform-fee payment and a provider checkout URL (mock in dev). */
export async function createPlatformPayment(opts: {
  requesterId: string;
  purpose: PaymentPurpose;
  requestId?: string;
  couponCode?: string;
  returnTo: string;
}) {
  const requester = await db.requesterProfile.findUniqueOrThrow({ where: { id: opts.requesterId } });
  const price = await priceFor(requester.country);
  let amount =
    opts.purpose === "ONBOARDING"
      ? Number(price.onboardingFee) + Number(price.yearlyFee) // onboarding + first year together
      : opts.purpose === "SUBSCRIPTION"
        ? Number(price.yearlyFee)
        : Number(price.perRequestFee);

  let discount = 0;
  let couponCode: string | undefined;
  if (opts.couponCode) {
    const coupon = await db.coupon.findUnique({ where: { code: opts.couponCode.toUpperCase() } });
    if (coupon && couponOpen(coupon)) {
      discount = (amount * coupon.percentOff) / 100;
      amount -= discount;
      couponCode = coupon.code; // counted as used only once paid (settlePayment)
    }
  }
  const { tax, total } = withTax(amount, price.taxRate);

  // The owner's consent request fee: collected in-app alongside the platform
  // fee and held until they answer (80% to them on a yes, settled weekly; 80%
  // refunded otherwise). Deal fees after approval never move through Consent.
  if (opts.purpose === "PER_REQUEST" && opts.requestId) {
    const request = await db.consentRequest.findUnique({
      where: { id: opts.requestId },
      include: { consenter: { include: { priceTiers: true } } },
    });
    const ask = request ? consentPriceFor(request.consenter, request.intentCategoryId) : null;
    const unpaidAsks = await db.payment.findMany({
      where: { requestId: opts.requestId, purpose: "CONSENT_PRICE", status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    // Unpaid lines left by an abandoned checkout must not be charged again:
    // keep one at most, and none once asking is free (e.g. the intent changed).
    const existing = ask ? unpaidAsks[0] : undefined;
    const drop = unpaidAsks.filter((p) => p !== existing).map((p) => p.id);
    if (drop.length) await db.payment.deleteMany({ where: { id: { in: drop }, status: "PENDING" } });
    if (request && ask) {
      if (existing) {
        // The intent (and so the tier) may have changed since an abandoned checkout.
        if (
          existing.amount.toString() !== ask.toString() ||
          existing.currency !== request.consenter.consentPriceCurrency
        ) {
          await db.payment.update({
            where: { id: existing.id },
            data: { amount: ask, currency: request.consenter.consentPriceCurrency },
          });
        }
      } else {
        await db.payment.create({
          data: {
            requesterId: opts.requesterId,
            purpose: "CONSENT_PRICE",
            amount: ask,
            currency: request.consenter.consentPriceCurrency,
            provider: paymentProviderFor(requester.country).name,
            requestId: opts.requestId,
          },
        });
      }
    }
  }

  const fields = {
    amount: new Prisma.Decimal(total.toFixed(2)),
    currency: price.currency,
    provider: paymentProviderFor(requester.country).name,
    couponCode: couponCode ?? null,
    discount: discount ? new Prisma.Decimal(discount.toFixed(2)) : null,
    tax: tax ? new Prisma.Decimal(tax.toFixed(2)) : null,
    taxLabel: price.taxLabel ?? null,
  };
  // Submitting again after leaving checkout reuses the unpaid fee line for the
  // request instead of adding a second one that checkout would also charge.
  const [unpaid, ...dupes] = opts.requestId
    ? await db.payment.findMany({
        where: { requestId: opts.requestId, purpose: opts.purpose, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      })
    : [];
  if (dupes.length)
    await db.payment.deleteMany({ where: { id: { in: dupes.map((p) => p.id) }, status: "PENDING" } });
  const payment = unpaid
    ? await db.payment.update({ where: { id: unpaid.id }, data: fields })
    : await db.payment.create({
        data: { ...fields, requesterId: opts.requesterId, purpose: opts.purpose, requestId: opts.requestId },
      });

  const provider = paymentProviderFor(requester.country);
  const { checkoutUrl, providerRef } = await provider.createCheckout({
    paymentId: payment.id,
    amount: total.toFixed(2),
    currency: price.currency,
    description: CHECKOUT_DESCRIPTION[opts.purpose],
    returnTo: opts.returnTo,
  });
  await db.payment.update({ where: { id: payment.id }, data: { providerRef } });
  return { payment, checkoutUrl };
}

/** Marks a payment paid and applies its side effects. Idempotent. */
export async function settlePayment(paymentId: string) {
  const { onRequestPaid } = await import("./requests");
  const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status === "PAID") return payment;
  const year = new Date();
  year.setFullYear(year.getFullYear() + 1);
  const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-8)}`;
  const updated = await db.payment.update({
    where: { id: paymentId },
    data: { status: "PAID", paidAt: new Date(), invoiceNumber },
  });
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
  if (payment.purpose === "ONBOARDING") {
    await db.requesterProfile.update({
      where: { id: payment.requesterId },
      data: { onboardingFeePaidAt: new Date(), subscriptionEndsAt: year },
    });
  } else if (payment.purpose === "SUBSCRIPTION") {
    const r = await db.requesterProfile.findUniqueOrThrow({ where: { id: payment.requesterId } });
    const base = r.subscriptionEndsAt && r.subscriptionEndsAt > new Date() ? r.subscriptionEndsAt : new Date();
    const next = new Date(base);
    next.setFullYear(next.getFullYear() + 1);
    await db.requesterProfile.update({
      where: { id: payment.requesterId },
      data: { subscriptionEndsAt: next },
    });
  } else if (payment.purpose === "PER_REQUEST" && payment.requestId) {
    await onRequestPaid(payment.requestId);
  } else if (payment.purpose === "CONSENT_PRICE" && payment.requestId) {
    // Credit the consenter's balance; paid out in the weekly settlement sweep.
    const request = await db.consentRequest.findUnique({ where: { id: payment.requestId } });
    if (request) {
      await db.earningEntry.upsert({
        where: { paymentId: payment.id },
        update: {},
        create: {
          consenterId: request.consenterId,
          requestId: payment.requestId,
          paymentId: payment.id,
          // Held until the owner answers: 80% is theirs on a yes, 80% is refunded otherwise.
          amount: splitConsentFee(Number(payment.amount.toString())).owner.toFixed(2),
          grossAmount: payment.amount,
          currency: payment.currency,
        },
      });
    }
  }
  // The consent request fee is held until the owner answers; if the request already has
  // an answer (auto-approved or auto-declined on payment), settle it now.
  if (payment.requestId) await syncConsentPrice(payment.requestId);
  return updated;
}

/** All payments a submission checkout must cover (platform fee + consent request fee). */
export async function pendingPaymentsForRequest(requestId: string) {
  return db.payment.findMany({
    where: { requestId, status: "PENDING" },
    orderBy: { purpose: "asc" },
  });
}

/** True when the requester profile can send new requests. */
export function requesterActive(r: { status: string; onboardingFeePaidAt: Date | null; subscriptionEndsAt: Date | null }) {
  return (
    r.status === "APPROVED" &&
    !!r.onboardingFeePaidAt &&
    !!r.subscriptionEndsAt &&
    r.subscriptionEndsAt > new Date()
  );
}
