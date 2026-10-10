import { test, expect } from "@playwright/test";
import { db, consenterBySlug, requesterBySlug } from "./db";
import { expectStatus, pageFor, runJobs, submitBasicRequest, visit } from "./helpers";

/**
 * Window expiry: Daily Lens News asks Volt Energy. Volt is free to ask, so
 * the request is sent at once with no checkout and no payment at all. Every
 * action on the request (sending, timeline events, uploads) is backdated past
 * the 7-day window via Prisma, the jobs tick runs, and we assert: status
 * Expired (no response), still no payment, and Volt's Consent Score for
 * answering decreased.
 *
 * The score is recomputed from scratch on expiry, so a throw-away expired
 * request establishes a recalculated baseline first; the second expiry must
 * then land strictly lower (worse response rate + bigger penalty).
 */
test("an unanswered free request expires and dents the owner's score", async ({ browser, request }) => {
  const news = await pageFor(browser, "news");

  const requestId = await submitBasicRequest(news, {
    slug: "volt-energy",
    query: "Volt",
    formats: [{ platform: "Instagram", format: "Reel", durationSec: 20 }],
    assetTypes: ["Logo/trademark"],
    uploadAsset: true,
    uploadRaw: false,
    intent: "News",
    charge: "free", // Volt is free to ask → no checkout
  });
  await expectStatus(requestId, "PENDING");
  await expect(news.getByText("Pending", { exact: true }).first()).toBeVisible();
  await expect(news.getByText("Free to ask. Nothing was charged.")).toBeVisible();
  expect(await db.payment.count({ where: { requestId } })).toBe(0);

  const volt = await consenterBySlug("volt-energy");
  const dailyLens = await requesterBySlug("daily-lens-news");

  // ── Baseline: expire a throw-away request so the stored score is a
  //    freshly recalculated value, then record it. ────────────────────
  await db.consentRequest.create({
    data: {
      requesterId: dailyLens.id,
      consenterId: volt.id,
      status: "PENDING",
      selections: [],
      assetTypeIds: [],
      assetTypeNames: [],
      context: "E2E baseline request for score recalibration",
      creativePlan: "E2E baseline request for score recalibration",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 8 * 86400_000),
      slaExpiresAt: new Date(Date.now() - 86400_000),
    },
  });
  await runJobs(request);
  const before = (await consenterBySlug("volt-energy")).score;

  // ── No action for 8 days: backdate everything the window counts as an action ──
  const eightDaysAgo = new Date(Date.now() - 8 * 86400_000);
  await db.consentRequest.update({ where: { id: requestId }, data: { submittedAt: eightDaysAgo } });
  await db.requestEvent.updateMany({ where: { requestId }, data: { createdAt: eightDaysAgo } });
  await db.requestMessage.updateMany({ where: { requestId }, data: { createdAt: eightDaysAgo } });
  await db.storedFile.updateMany({ where: { requestId }, data: { createdAt: eightDaysAgo } });
  await runJobs(request);

  await expectStatus(requestId, "EXPIRED_NO_RESPONSE");
  // A free ask has nothing to forfeit or refund.
  expect(await db.payment.count({ where: { requestId } })).toBe(0);
  expect(await db.earningEntry.count({ where: { requestId } })).toBe(0);

  const after = (await consenterBySlug("volt-energy")).score;
  expect(after).toBeLessThan(before);

  // The asker sees the expiry.
  await visit(news, `/r-panel/requests/${requestId}`);
  await expect(news.getByText("Expired (no response)", { exact: true }).first()).toBeVisible();
  await expect(news.getByText(/did not respond within the window/)).toBeVisible();
  await expect(news.getByRole("link", { name: /^Ask Volt Energy again/ })).toBeVisible();

  await news.context().close();
});
