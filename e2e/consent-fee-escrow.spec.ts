import { test, expect } from "@playwright/test";
import { db } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Ask price escrow: Nightwatch charges a $100 consent price. It is held when
 * Acme Clips pays to ask. When the show declines, the ask price is refunded to
 * Acme Clips (the platform fee is not). When the show approves another
 * request, the ask price becomes the show's and waits for the weekly payout.
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

test("ask price is refunded on a decline and paid to the owner on a yes", async ({ browser }) => {
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");
  show.on("dialog", (d) => d.accept());

  // ── 1. Declined → ask price refunded, platform fee kept ─────
  const declinedId = await submitBasicRequest(clips, ask);
  expect((await earningFor(declinedId))!.status).toBe("HELD");

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
  const platformFee = await db.payment.findFirst({ where: { requestId: declinedId, purpose: "PER_REQUEST" } });
  expect(platformFee!.status).toBe("PAID");

  await visit(clips, `/r-panel/requests/${declinedId}`);
  await expect(clips.getByText(/consent\s+price is refunded to you; the platform fee is not/)).toBeVisible();

  // ── 2. Approved → ask price is the owner's, paid out weekly ──
  const approvedId = await submitBasicRequest(clips, ask);
  expect((await earningFor(approvedId))!.status).toBe("HELD");

  await visit(show, `/c-panel/requests/${approvedId}`);
  await show.getByRole("button", { name: /^Approve/ }).click();
  await expect
    .poll(async () => (await earningFor(approvedId))!.status)
    .toBe("PENDING");
  expect((await earningFor(approvedId))!.payment.status).toBe("PAID");

  await visit(show, "/c-panel/earnings");
  await expect(show.getByText(/Yours · paid out/).first()).toBeVisible();
  await expect(show.getByText(/Refunded to Acme Clips/).first()).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
