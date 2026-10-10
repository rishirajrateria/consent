import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Flow 6 — revocation + takedown: a fresh grant is issued (clips → Jane,
 * Name/Photo on a YouTube Short is auto-approved by Jane's consent matrix,
 * raw uploaded → instant grant). Jane revokes it with a reason and raises a
 * takedown with a live link; clips marks the content taken down; Jane
 * confirms. The /v page shows REVOKED with the revocation note, and the
 * takedown history shows "Takedown confirmed".
 */
test("revoked grant with confirmed takedown shows on the public page", async ({ browser }) => {
  const stamp = Date.now();
  const revokeReason = `E2E revocation ${stamp}: used outside the approved scope.`;
  const takedownReason = `E2E takedown ${stamp}: content must come down`;

  // ── Issue a fresh grant (matrix auto-approve + raw file) ────
  const clips = await pageFor(browser, "clips");
  const requestId = await submitBasicRequest(clips, {
    slug: "jane-carter",
    query: "Jane",
    formats: [{ platform: "YouTube", format: "Shorts", durationSec: 20 }],
    assetTypes: ["Name", "Photo/picture"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Tribute",
  });
  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();
  expect(grant!.status).toBe("ACTIVE");

  // ── Jane revokes the grant with a mandatory reason ──────────
  const jane = await pageFor(browser, "jane");
  jane.on("dialog", (d) => d.accept());
  await visit(jane, `/c-panel/requests/${requestId}`);
  await jane.getByText("Revoke this grant", { exact: true }).click();
  await jane.fill('textarea[name="reason"]', revokeReason);
  await jane.getByRole("button", { name: "Revoke grant" }).click();
  await expect(jane.getByText(/Revoked on/).first()).toBeVisible();

  // ── Jane raises a takedown with a live link ─────────────────
  await jane.getByText("Raise a takedown request", { exact: true }).click();
  const takedownForm = jane.locator("form", { has: jane.getByRole("button", { name: "Send takedown request" }) });
  await takedownForm.locator('input[name="reason"]').fill(takedownReason);
  await takedownForm.locator('textarea[name="links"]').fill(`https://example.com/e2e-live-${stamp}`);
  await takedownForm.getByRole("button", { name: "Send takedown request" }).click();
  await expect(jane.getByText(takedownReason)).toBeVisible();
  await expect(jane.getByText("Raised", { exact: true })).toBeVisible();

  // ── Clips marks the content taken down ──────────────────────
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText(takedownReason)).toBeVisible();
  await clips.getByRole("button", { name: "Content taken down" }).click();
  await expect(clips.getByText("Marked taken down", { exact: true })).toBeVisible();

  // ── Jane confirms it is down ────────────────────────────────
  await visit(jane, `/c-panel/requests/${requestId}`);
  await jane.getByRole("button", { name: /Confirm it/ }).click();
  await expect(jane.getByText("Takedown confirmed", { exact: true }).first()).toBeVisible();

  const revoked = await grantForRequest(requestId);
  expect(revoked!.status).toBe("REVOKED");
  expect(revoked!.revokeReason).toBe(revokeReason);

  // ── Public verification page shows it all ───────────────────
  await visit(jane, `/v/${grant!.publicId}`);
  await expect(jane.getByText("Revoked", { exact: true })).toBeVisible();
  await expect(jane.getByText(new RegExp(`E2E revocation ${stamp}`)).first()).toBeVisible();
  await expect(jane.getByText("Takedown history")).toBeVisible();
  await expect(jane.getByText("Takedown confirmed", { exact: true })).toBeVisible();

  await clips.context().close();
  await jane.context().close();
});
