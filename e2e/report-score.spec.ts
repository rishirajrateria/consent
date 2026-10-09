import { test, expect } from "@playwright/test";
import { db, requesterBySlug } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Flow 7 — report + score: Jane files a breach report on a freshly approved
 * request from Acme Clips; the admin upholds it in /admin/reports; clips'
 * requester score drops (checked via Prisma) and the report shows Upheld.
 *
 * Issuing the fresh grant triggers a score recalculation, so the recorded
 * baseline is a freshly computed value and the uphold penalty must land
 * strictly below it.
 */
test("upheld breach report lowers the requester score", async ({ browser }) => {
  const stamp = Date.now();
  const description = `E2E report ${stamp}: the published short is missing the mandatory consent verification link.`;

  // Older e2e reports would skew the recalculated baseline — clear them.
  await db.report.deleteMany({ where: { description: { startsWith: "E2E report" } } });

  // ── Fresh approved request with a grant (matrix auto-approve) ─
  const clips = await pageFor(browser, "clips");
  const requestId = await submitBasicRequest(clips, {
    slug: "jane-carter",
    query: "Jane",
    formats: [{ platform: "YouTube", format: "Shorts", durationSec: 15 }],
    assetTypes: ["Name", "Photo/picture"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Entertainment",
  });
  const approved = await db.consentRequest.findUnique({ where: { id: requestId } });
  expect(approved!.status).toBe("APPROVED");

  const before = (await requesterBySlug("acme-clips")).score;

  // ── Jane files a report on the approved request ──────────────
  const jane = await pageFor(browser, "jane");
  await visit(jane, `/c-panel/requests/${requestId}`);
  await jane.getByText(/Report a breach on this requester/).click();
  await jane.selectOption('select[name="reason"]', { label: "Missing consent link" });
  await jane.fill('textarea[name="description"]', description);
  await jane.getByRole("button", { name: "File report" }).click();
  await jane.waitForURL(/reported=1/);
  await expect(jane.getByText(description)).toBeVisible();

  const report = await db.report.findFirst({ where: { description } });
  expect(report).toBeTruthy();
  expect(report!.status).toBe("OPEN");

  // ── Admin upholds it in the trust & safety queue ─────────────
  const admin = await pageFor(browser, "admin");
  await visit(admin, "/admin/reports");
  const card = admin.locator(`form:has(input[name="id"][value="${report!.id}"])`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Uphold" }).click();

  await expect
    .poll(async () => (await db.report.findUnique({ where: { id: report!.id } }))!.status, {
      timeout: 15_000,
    })
    .toBe("UPHELD");

  // ── Score dropped and the report shows Upheld ────────────────
  const after = (await requesterBySlug("acme-clips")).score;
  expect(after).toBeLessThan(before);

  await visit(jane, `/c-panel/requests/${requestId}`);
  await expect(jane.getByText("Upheld", { exact: true })).toBeVisible();

  await visit(admin, "/admin/reports?tab=Upheld");
  await expect(admin.getByText(description)).toBeVisible();

  await clips.context().close();
  await jane.context().close();
  await admin.context().close();
});
