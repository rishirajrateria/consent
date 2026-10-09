import { db } from "./db";
import { paymentProviderFor } from "./providers";
import type { PaymentPurpose } from "@prisma/client";
import { Prisma } from "@prisma/client";

export async function priceFor(country: string) {
  const row =
    (await db.priceConfig.findUnique({ where: { country } })) ??
    (await db.priceConfig.findUnique({ where: { country: "DEFAULT" } }));
  if (!row) throw new Error("No pricing configured");
  return row;
}

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
    const valid =
      coupon &&
      coupon.active &&
      (!coupon.expiresAt || coupon.expiresAt > new Date()) &&
      (coupon.maxUses == null || coupon.usedCount < coupon.maxUses);
    if (valid) {
      discount = (amount * coupon.percentOff) / 100;
      amount -= discount;
      couponCode = coupon.code;
      await db.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }
  }
  const tax = price.taxRate ? (amount * Number(price.taxRate)) / 100 : 0;
  const total = amount + tax;

  // Consenter-set consent price: collected in-app alongside the platform fee,
  // credited to the consenter's balance and settled weekly. Deal fees after
  // approval still never move through Consent.
  if (opts.purpose === "PER_REQUEST" && opts.requestId) {
    const request = await db.consentRequest.findUnique({
      where: { id: opts.requestId },
      include: { consenter: true },
    });
    const ask = request?.consenter.consentPrice;
    if (request && ask && Number(ask) > 0) {
      const existing = await db.payment.findFirst({
        where: { requestId: opts.requestId, purpose: "CONSENT_PRICE", status: "PENDING" },
      });
      if (!existing) {
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

  const payment = await db.payment.create({
    data: {
      requesterId: opts.requesterId,
      purpose: opts.purpose,
      amount: new Prisma.Decimal(total.toFixed(2)),
      currency: price.currency,
      provider: paymentProviderFor(requester.country).name,
      couponCode,
      discount: discount ? new Prisma.Decimal(discount.toFixed(2)) : undefined,
      tax: tax ? new Prisma.Decimal(tax.toFixed(2)) : undefined,
      taxLabel: price.taxLabel ?? undefined,
      requestId: opts.requestId,
    },
  });

  const provider = paymentProviderFor(requester.country);
  const { checkoutUrl, providerRef } = await provider.createCheckout({
    paymentId: payment.id,
    amount: total.toFixed(2),
    currency: price.currency,
    description: `Consent ${opts.purpose.toLowerCase()} fee`,
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
          amount: payment.amount,
          currency: payment.currency,
        },
      });
    }
  }
  return updated;
}

/** All payments a submission checkout must cover (platform fee + consent price). */
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
