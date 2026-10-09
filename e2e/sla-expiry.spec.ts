import { test, expect } from "@playwright/test";
import { db, consenterBySlug, requesterBySlug } from "./db";
import { pageFor, runJobs, submitBasicRequest, visit } from "./helpers";

/**
 * Flow 4 — SLA expiry: Daily Lens News asks Volt Energy (no consent price →
 * single checkout line). The request's slaExpiresAt is backdated via Prisma,
 * the jobs tick runs, and we assert: status Expired (no response), the
 * PER_REQUEST payment FORFEITED, and Volt's consenter score decreased.
 *
 * The score is recomputed from scratch on expiry, so a throw-away expired
 * request establishes a recalculated baseline first; the second expiry must
 * then land strictly lower (worse response rate + bigger penalty).
 */
test("unanswered request expires, forfeits the fee and dents the score", async ({ browser, request }) => {
  const news = await pageFor(browser, "news");

  const requestId = await submitBasicRequest(news, {
    slug: "volt-energy",
    query: "Volt",
    formats: [{ platform: "Instagram", format: "Reel", durationSec: 20 }],
    assetTypes: ["Logo/trademark"],
    uploadAsset: true,
    uploadRaw: false,
    intent: "News",
    expectSingleCharge: true, // Volt has no consent price → one payment line
  });
  await expect(news.getByText("Pending", { exact: true }).first()).toBeVisible();

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

  // ── Force the real request past its SLA and run the sweeps ──
  await db.consentRequest.update({
    where: { id: requestId },
    data: { slaExpiresAt: new Date(Date.now() - 60_000) },
  });
  await runJobs(request);

  const expired = await db.consentRequest.findUnique({ where: { id: requestId } });
  expect(expired!.status).toBe("EXPIRED_NO_RESPONSE");

  const fee = await db.payment.findFirst({
    where: { requestId, purpose: "PER_REQUEST" },
  });
  expect(fee).toBeTruthy();
  expect(fee!.status).toBe("FORFEITED");

  const after = (await consenterBySlug("volt-energy")).score;
  expect(after).toBeLessThan(before);

  // UI reflects the expiry for the requester.
  await visit(news, `/r-panel/requests/${requestId}`);
  await expect(news.getByText("Expired (no response)", { exact: true }).first()).toBeVisible();
  await expect(news.getByText(/did not respond within the window/)).toBeVisible();

  await news.context().close();
});
