import { test, expect } from "@playwright/test";
import { db } from "./db";
import { expectStatus, pageFor, submitBasicRequest, visit, type RequestSpec } from "./helpers";

/**
 * Consent request fee escrow: Nightwatch charges a $100 consent request fee.
 * The asker pays it plus the platform fee (20% of the consent request fee,
 * $20, in the same currency) on one checkout. The fee is held until the show
 * answers. When the show declines, 80% ($80) goes back to Acme Clips; Consent
 * keeps 20% and the platform fee is never refunded. When the show approves
 * another request, 80% ($80) becomes the show's and waits for the weekly
 * payout.
 */
const ask: RequestSpec = {
  slug: "nightwatch-series",
  query: "Nightwatch",
  formats: [{ platform: "YouTube", format: "Long video", durationSec: 30 }],
  assetTypes: ["Character/show footage"],
  uploadAsset: true,
  uploadRaw: true,
  intent: "Review",
  charge: "paid",
};

async function earningFor(requestId: string) {
  return db.earningEntry.findUnique({ where: { requestId }, include: { payment: true } });
}

async function paymentsFor(requestId: string) {
  const [fee, platform] = await Promise.all([
    db.payment.findFirst({ where: { requestId, purpose: "CONSENT_PRICE" } }),
    db.payment.findFirst({ where: { requestId, purpose: "PER_REQUEST" } }),
  ]);
  return { fee, platform };
}

test("the platform fee is 20% of the consent request fee; 80% is refunded on a decline and paid to the owner on a yes", async ({ browser }) => {
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");
  show.on("dialog", (d) => d.accept());

  // ── 1. One checkout: $100 consent request fee + $20 platform fee ──
  const declinedId = await submitBasicRequest(clips, ask);
  await expect.poll(async () => (await earningFor(declinedId))?.status).toBe("HELD");
  const held = await earningFor(declinedId);
  expect(Number(held!.grossAmount)).toBe(100);
  expect(Number(held!.amount)).toBe(80);

  const { fee, platform } = await paymentsFor(declinedId);
  expect(fee!.status).toBe("PAID");
  expect(Number(fee!.amount)).toBe(100);
  expect(platform!.status).toBe("PAID");
  // 20% of the consent request fee, before any tax on the platform fee.
  expect(Number(platform!.amount) - Number(platform!.tax ?? 0)).toBeCloseTo(20, 2);
  // Same currency as the consent request fee, on the same provider checkout.
  expect(fee!.currency).toBe("USD");
  expect(platform!.currency).toBe(fee!.currency);
  expect(platform!.providerRef).toBe(fee!.providerRef);

  // ── 2. Declined → 80% refunded, the platform fee kept ───────
  await visit(show, `/c-panel/requests/${declinedId}`);
  await expect(show.getByText(/Yours if you say yes \(80%\)/).first()).toBeVisible();
  await show.getByRole("radio", { name: "Decline" }).click();
  await show.getByRole("button", { name: "Decline request" }).click();
  await expectStatus(declinedId, "DENIED");

  await expect.poll(async () => (await earningFor(declinedId))?.status).toBe("REFUNDED");
  const refunded = await earningFor(declinedId);
  expect(refunded!.payment.status).toBe("REFUNDED");
  expect(refunded!.payment.refundedAt).toBeTruthy();
  expect(Number(refunded!.payment.refundedAmount)).toBe(80);
  const platformAfter = await db.payment.findFirst({ where: { requestId: declinedId, purpose: "PER_REQUEST" } });
  expect(platformAfter!.status).toBe("PAID");
  expect(platformAfter!.refundedAmount).toBeNull();

  await visit(clips, `/r-panel/requests/${declinedId}`);
  await expect(clips.getByRole("heading", { name: "What you paid" })).toBeVisible();
  await expect(clips.getByText(/80% \(\$80\.00\) was refunded to you/).first()).toBeVisible();

  // ── 3. Approved → 80% is the owner's, paid out on Fridays ────
  const approvedId = await submitBasicRequest(clips, { ...ask, expectTotal: "$120.00" });
  await expect.poll(async () => (await earningFor(approvedId))?.status).toBe("HELD");

  await visit(show, `/c-panel/requests/${approvedId}`);
  await show.getByRole("button", { name: /^Approve/ }).click();
  await expectStatus(approvedId, "APPROVED");
  await expect.poll(async () => (await earningFor(approvedId))?.status).toBe("PENDING");
  const released = await earningFor(approvedId);
  expect(released!.payment.status).toBe("PAID");
  expect(Number(released!.amount)).toBe(80);

  await visit(show, "/c-panel/earnings");
  await expect(show.getByText(/Yours · paid out/).first()).toBeVisible();
  await expect(show.getByText(/Refunded to Acme Clips/).first()).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
