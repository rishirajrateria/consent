import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { expectStatus, pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Standing rule auto-approval: Jane has a standing rule that approves
 * whitelisted news channels using her Name/Photo for 30s or less, and Daily
 * Lens News is on her whitelist. Jane's fee for News is free, so the request
 * is sent at once with no checkout. A matching YouTube Shorts request with
 * the final content file uploaded is APPROVED with a certificate straight
 * away, and the certificate page credits the standing rule.
 */
test("a whitelisted news request is approved by Jane's standing rule", async ({ browser }) => {
  const news = await pageFor(browser, "news");

  const requestId = await submitBasicRequest(news, {
    slug: "jane-carter",
    query: "Jane",
    formats: [{ platform: "YouTube", format: "Shorts", durationSec: 25 }],
    assetTypes: ["Name", "Photo/picture"],
    uploadAsset: true,
    uploadRaw: true, // final file in → the certificate is issued on the automatic yes
    intent: "News",
    charge: "free", // Jane's fee for News is free
  });

  // Straight to Approved with a certificate: no human decision involved.
  await expectStatus(requestId, "APPROVED");
  await visit(news, `/r-panel/requests/${requestId}`);
  await expect(news.getByRole("heading", { name: "Certificate", exact: true })).toBeVisible();
  await expect(news.getByText("Approved", { exact: true }).first()).toBeVisible();

  const request = await db.consentRequest.findUnique({ where: { id: requestId } });
  expect(request!.decidedByRuleName).toContain("Auto-approve trusted newsrooms");
  expect(request!.decidedById).toBeNull();
  expect(await db.payment.count({ where: { requestId } })).toBe(0);

  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();
  expect(grant!.status).toBe("ACTIVE");

  // The certificate page shows the standing rule in "Decided by".
  await visit(news, `/v/${grant!.publicId}`);
  await expect(news.getByText("Verified authentic")).toBeVisible();
  await expect(news.getByText(/standing rule/).first()).toBeVisible();
  await expect(news.getByText(/Auto-approve trusted newsrooms/).first()).toBeVisible();

  await news.context().close();
});
