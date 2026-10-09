import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Flow 3 — standing rule auto-approval: Jane has a standing rule that
 * auto-approves whitelisted NEWS_CHANNEL requesters using Name/Photo ≤ 30s,
 * and Daily Lens News is whitelisted. A matching YouTube Shorts request with
 * raw content uploaded is APPROVED with a grant right after payment, and the
 * certificate page attributes the decision to the standing rule.
 */
test("whitelisted news request is auto-approved by Jane's standing rule", async ({ browser }) => {
  const news = await pageFor(browser, "news");

  const requestId = await submitBasicRequest(news, {
    slug: "jane-carter",
    query: "Jane",
    formats: [{ platform: "YouTube", format: "Shorts", durationSec: 25 }],
    assetTypes: ["Name", "Photo/picture"],
    uploadAsset: true,
    uploadRaw: true, // raw present → grant issues immediately on auto-approval
    intent: "News",
  });

  // Straight to Approved with an issued grant — no human decision involved.
  await expect(news.getByText("Consent grant")).toBeVisible();
  await expect(news.getByText("Approved", { exact: true }).first()).toBeVisible();

  const request = await db.consentRequest.findUnique({ where: { id: requestId } });
  expect(request!.status).toBe("APPROVED");
  expect(request!.decidedByRuleName).toContain("Auto-approve whitelisted news");
  expect(request!.decidedById).toBeNull();

  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();
  expect(grant!.status).toBe("ACTIVE");

  // Certificate page shows the standing rule in "Decided by".
  await visit(news, `/v/${grant!.publicId}`);
  await expect(news.getByText("Signature verified (Ed25519)")).toBeVisible();
  await expect(news.getByText(/standing rule/)).toBeVisible();
  await expect(news.getByText(/Auto-approve whitelisted news/)).toBeVisible();

  await news.context().close();
});
