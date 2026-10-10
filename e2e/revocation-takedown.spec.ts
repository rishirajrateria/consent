import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { expectStatus, pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Revocation + takedown: a fresh certificate is issued (Acme Clips → Jane,
 * Name/Photo on a YouTube Short is approved automatically by Jane's terms,
 * final file uploaded → instant certificate). Jane revokes the consent with a
 * reason and raises a takedown with a live link; Acme Clips marks the content
 * taken down; Jane confirms. The /v page shows Revoked with the reason, and
 * the takedown history shows "Takedown confirmed".
 */
async function takedownFor(grantId: string) {
  return db.takedownRequest.findFirst({ where: { grantId }, orderBy: { createdAt: "desc" } });
}

test("revoked consent with a confirmed takedown shows on the public page", async ({ browser }) => {
  const stamp = Date.now();
  const revokeReason = `E2E revocation ${stamp}: used outside the approved scope.`;
  const takedownReason = `E2E takedown ${stamp}: content must come down`;

  // ── Issue a fresh certificate (automatic yes + final file) ───
  const clips = await pageFor(browser, "clips");
  const requestId = await submitBasicRequest(clips, {
    slug: "jane-carter",
    query: "Jane",
    formats: [{ platform: "YouTube", format: "Shorts", durationSec: 20 }],
    assetTypes: ["Name", "Photo/picture"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Tribute",
    charge: "paid", // Jane's consent request fee
  });
  await expectStatus(requestId, "APPROVED");
  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();
  expect(grant!.status).toBe("ACTIVE");

  // ── Jane revokes the consent with a mandatory reason ────────
  const jane = await pageFor(browser, "jane");
  jane.on("dialog", (d) => d.accept());
  await visit(jane, `/c-panel/requests/${requestId}`);
  await jane.getByText("Revoke this consent", { exact: true }).click();
  await jane.fill('textarea[name="reason"]', revokeReason);
  await jane.getByRole("button", { name: "Revoke consent" }).click();
  await expect.poll(async () => (await grantForRequest(requestId))?.status).toBe("REVOKED");
  await visit(jane, `/c-panel/requests/${requestId}`);
  await expect(jane.getByText(/Revoked on/).first()).toBeVisible();

  // ── Jane raises a takedown with a live link ─────────────────
  await jane.getByText("Raise a takedown request", { exact: true }).click();
  const takedownForm = jane.locator("form", { has: jane.getByRole("button", { name: "Send takedown request" }) });
  await takedownForm.locator('input[name="reason"]').fill(takedownReason);
  await takedownForm.locator('textarea[name="links"]').fill(`https://example.com/e2e-live-${stamp}`);
  await takedownForm.getByRole("button", { name: "Send takedown request" }).click();
  await expect.poll(async () => (await takedownFor(grant!.id))?.status).toBe("RAISED");
  await visit(jane, `/c-panel/requests/${requestId}`);
  await expect(jane.getByText(`Reason: ${takedownReason}`)).toBeVisible();
  await expect(jane.getByText("Raised", { exact: true }).first()).toBeVisible();

  // ── Clips marks the content taken down ──────────────────────
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText(`Reason: ${takedownReason}`)).toBeVisible();
  await clips.getByRole("button", { name: "Content taken down" }).click();
  await expect.poll(async () => (await takedownFor(grant!.id))?.status).toBe("MARKED_DOWN");
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText("Marked taken down", { exact: true }).first()).toBeVisible();

  // ── Jane confirms it is down ────────────────────────────────
  await visit(jane, `/c-panel/requests/${requestId}`);
  await jane.getByRole("button", { name: /Confirm it/ }).click();
  await expect.poll(async () => (await takedownFor(grant!.id))?.status).toBe("CONFIRMED");
  await visit(jane, `/c-panel/requests/${requestId}`);
  await expect(jane.getByText("Takedown confirmed", { exact: true }).first()).toBeVisible();

  const revoked = await grantForRequest(requestId);
  expect(revoked!.status).toBe("REVOKED");
  expect(revoked!.revokeReason).toBe(revokeReason);

  // ── Public verification page shows it all ───────────────────
  await visit(jane, `/v/${grant!.publicId}`);
  await expect(jane.getByText("Revoked", { exact: true }).first()).toBeVisible();
  await expect(jane.getByText(new RegExp(`E2E revocation ${stamp}`)).first()).toBeVisible();
  await expect(jane.getByText("Takedown history")).toBeVisible();
  await expect(jane.getByText("Takedown confirmed", { exact: true }).first()).toBeVisible();

  await clips.context().close();
  await jane.context().close();
});
