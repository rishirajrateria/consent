import { test, expect } from "@playwright/test";
import { db } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Consent request fee escrow: Nightwatch charges a $100 consent request fee.
 * It is held when Acme Clips pays to ask. When the show declines, 80% ($80) is
 * refunded to Acme Clips; Consent keeps 20% and the platform fee is not
 * refunded. When the show approves another request, 80% ($80) becomes the
 * show's and waits for the weekly payout.
 */
const ask = {
  slug: "nightwatch-series",
  query: "Nightwatch",
  formats: [{ platform: "YouTube", format: "Long video", durationSec: 30 }],
  assetTypes: ["Character/show footage"],
  uploadAsset: true,
  uploadRaw: true,
  intent: "Review",
};

async function earningFor(requestId: string) {
  return db.earningEntry.findUnique({ where: { requestId }, include: { payment: true } });
}

test("80% of the consent request fee is refunded on a decline and paid to the owner on a yes", async ({ browser }) => {
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");
  show.on("dialog", (d) => d.accept());

  // ── 1. Declined → 80% refunded, platform fee kept ───────────
  const declinedId = await submitBasicRequest(clips, ask);
  const held = await earningFor(declinedId);
  expect(held!.status).toBe("HELD");
  expect(Number(held!.grossAmount)).toBe(100);
  expect(Number(held!.amount)).toBe(80);

  await visit(show, `/c-panel/requests/${declinedId}`);
  await show.getByRole("radio", { name: "Decline" }).click();
  await show.getByRole("button", { name: "Decline request" }).click();
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: declinedId } }))!.status)
    .toBe("DENIED");

  const refunded = await earningFor(declinedId);
  expect(refunded!.status).toBe("REFUNDED");
  expect(refunded!.payment.status).toBe("REFUNDED");
  expect(refunded!.payment.refundedAt).toBeTruthy();
  expect(Number(refunded!.payment.refundedAmount)).toBe(80);
  const platformFee = await db.payment.findFirst({ where: { requestId: declinedId, purpose: "PER_REQUEST" } });
  expect(platformFee!.status).toBe("PAID");

  await visit(clips, `/r-panel/requests/${declinedId}`);
  await expect(clips.getByText(/80%/).first()).toBeVisible();

  // ── 2. Approved → ask price is the owner's, paid out weekly ──
  const approvedId = await submitBasicRequest(clips, ask);
  expect((await earningFor(approvedId))!.status).toBe("HELD");

  await visit(show, `/c-panel/requests/${approvedId}`);
  await show.getByRole("button", { name: /^Approve/ }).click();
  await expect
    .poll(async () => (await earningFor(approvedId))!.status)
    .toBe("PENDING");
  const released = await earningFor(approvedId);
  expect(released!.payment.status).toBe("PAID");
  expect(Number(released!.amount)).toBe(80);

  await visit(show, "/c-panel/earnings");
  await expect(show.getByText(/Yours · paid out/).first()).toBeVisible();
  await expect(show.getByText(/Refunded to Acme Clips/).first()).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
