import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { expectStatus, pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Request to certificate: Acme Clips asks Nightwatch (a $100 consent request
 * fee, so it pays at the mock checkout) without the final content file yet.
 * The show approves with a written condition: that is a yes waiting for the
 * final file (approved in principle). Clips uploads the final file, the
 * certificate is issued at once, and the public /v page verifies it. No fee
 * is set or agreed on the way: the consent request fee was the only payment.
 */
test("approve, upload the final file, and get a verified certificate", async ({ browser }) => {
  const stamp = Date.now();
  const condition = `E2E ${stamp}: credit Nightwatch on screen.`;
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");

  const requestId = await submitBasicRequest(clips, {
    slug: "nightwatch-series",
    query: "Nightwatch",
    formats: [{ platform: "YouTube", format: "Long video", durationSec: 45 }],
    assetTypes: ["Character/show footage"],
    uploadAsset: true,
    uploadRaw: false,
    intent: "Review",
    charge: "paid",
  });
  await expectStatus(requestId, "PENDING");
  await expect(clips.getByText("Pending", { exact: true }).first()).toBeVisible();

  // ── The show reads it and approves, with a written condition ──
  await visit(show, `/c-panel/requests/${requestId}`);
  // Nothing to haggle over: no fee setting, no deal, no paperwork, no contacts, no meetings.
  for (const gone of [/^Set a fee$/, /Approve the deal/, /legally binding/i, /Share my contact details/, /schedule a meeting/i]) {
    await expect(show.getByText(gone)).toHaveCount(0);
  }
  await show.getByText(/^Conditions \(optional\)/).click();
  await show.locator('textarea[name="conditionsNote"]').fill(condition);
  await show.getByRole("button", { name: /^Approve/ }).click();
  await expectStatus(requestId, "APPROVED_IN_PRINCIPLE");
  expect(await grantForRequest(requestId)).toBeNull();
  const decided = await db.consentRequest.findUniqueOrThrow({ where: { id: requestId } });
  expect(decided.conditionsNote).toBe(condition);

  await visit(show, `/c-panel/requests/${requestId}`);
  await expect(show.getByText("Approved, final file needed", { exact: true }).first()).toBeVisible();

  // ── Clips uploads the final content file → certificate ──────
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText(/said yes\./).first()).toBeVisible();
  await expect(
    clips.getByRole("heading", { name: "Upload the final content file to get your certificate" }),
  ).toBeVisible();
  const finalForm = clips.locator('form:has(input[name="kind"][value="RAW_CONTENT"])');
  await finalForm.locator('input[name="file"]').setInputFiles({
    name: `e2e-final-${stamp}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`E2E final content ${stamp}`),
  });
  await finalForm.getByRole("button", { name: "Upload and get certificate" }).click();
  await clips.waitForURL(/certified=upload/);
  await expect(clips.getByText("Final file uploaded. Your certificate is ready.")).toBeVisible();
  await expect(clips.getByRole("heading", { name: "Certificate", exact: true })).toBeVisible();
  await expectStatus(requestId, "APPROVED");

  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();
  expect(grant!.status).toBe("ACTIVE");
  // New certificates carry no deal terms.
  const payload = grant!.payload as Record<string, unknown>;
  expect(payload.fee).toBeUndefined();
  expect(payload.agreementMode).toBeUndefined();

  // ── Public verification page ────────────────────────────────
  await visit(clips, `/v/${grant!.publicId}`);
  await expect(clips.getByText("Verified authentic")).toBeVisible();
  await expect(clips.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(clips.getByText(grant!.certificateId).first()).toBeVisible();
  await expect(clips.getByText(/Usage fee|Agreement mode|Legally binding/)).toHaveCount(0);

  await clips.context().close();
  await show.context().close();
});

/**
 * A yes when the final file is already in issues the certificate at once.
 * Kept separate so the in-principle path above stays the main story.
 */
test("approving a request that has its final file issues the certificate at once", async ({ browser }) => {
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");

  const requestId = await submitBasicRequest(clips, {
    slug: "nightwatch-series",
    query: "Nightwatch",
    formats: [{ platform: "YouTube", format: "Long video", durationSec: 30 }],
    assetTypes: ["Character/show footage"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Review",
    charge: "paid",
  });
  await expectStatus(requestId, "PENDING");

  await visit(show, `/c-panel/requests/${requestId}`);
  await show.getByRole("button", { name: /^Approve/ }).click();
  await expectStatus(requestId, "APPROVED");
  await expect.poll(async () => (await grantForRequest(requestId))?.status).toBe("ACTIVE");

  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByRole("heading", { name: "Certificate", exact: true })).toBeVisible();
  await expect(clips.getByText("Approved", { exact: true }).first()).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
