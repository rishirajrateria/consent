import { test, expect, type Page } from "@playwright/test";
import { db, grantForRequest, latestOtp } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

async function signAgreement(page: Page, url: string, email: string, typedName: string) {
  await visit(page, url);
  await page.getByRole("button", { name: "Email me a signature code" }).click();
  await page.waitForURL(/otp=sent/);
  const code = await latestOtp(email, "SIGNATURE");
  await page.fill('input[name="typedName"]', typedName);
  await page.fill('input[name="code"]', code);
  await page.getByRole("button", { name: "Sign agreement" }).click();
}

/**
 * Flow 5 — legally binding agreement: Acme Clips asks Jane (voice clip →
 * matrix says Ask, raw file uploaded so the grant can issue). Jane approves
 * with "Also propose a legally binding agreement" checked, clips accepts the
 * proposal and picks the platform-generated agreement, both sides sign with
 * typed name + SIGNATURE OTP codes read from the DB, the grant issues, and
 * the certificate page shows "Legally binding agreement".
 */
test("approval with a legally binding agreement signed by both sides", async ({ browser }) => {
  const clips = await pageFor(browser, "clips");
  const requestId = await submitBasicRequest(clips, {
    slug: "jane-carter",
    query: "Jane",
    formats: [{ platform: "YouTube", format: "Long video", durationSec: 40 }],
    assetTypes: ["Voice/audio clip"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Commentary",
  });
  await expect(clips.getByText("Pending", { exact: true }).first()).toBeVisible();

  // ── Jane approves and proposes a legally binding agreement ──
  const jane = await pageFor(browser, "jane");
  await visit(jane, `/c-panel/requests/${requestId}`);
  await jane.locator('input[name="proposeLegal"]').check();
  await jane.getByRole("button", { name: /^Approve/ }).click();
  await expect(jane.getByText("Legal agreement pending", { exact: true }).first()).toBeVisible();
  await expect(jane.getByText(/Waiting for the other side to accept or decline/)).toBeVisible();

  // ── Clips accepts the proposal and picks platform-generated ─
  await visit(clips, `/r-panel/requests/${requestId}`);
  await clips.getByRole("button", { name: /Accept — formalise it/ }).click();
  await expect(clips.getByText("Drafting", { exact: true }).first()).toBeVisible();
  await clips.getByRole("button", { name: "Generate agreement" }).click();
  await expect(clips.getByText(/Agreement text/)).toBeVisible();

  // ── Both sides sign: typed name + SIGNATURE OTP from the DB ─
  await signAgreement(clips, `/r-panel/requests/${requestId}`, "clips@demo.consent", "Casey Clips");
  await expect(clips.getByText(/You have signed/)).toBeVisible();

  await signAgreement(jane, `/c-panel/requests/${requestId}`, "jane@demo.consent", "Jane Elizabeth Carter");
  await expect(jane.getByText("Consent grant")).toBeVisible();

  const agreement = await db.agreement.findUnique({ where: { requestId } });
  expect(agreement!.status).toBe("COMPLETED");
  expect(agreement!.kind).toBe("PLATFORM_GENERATED");

  const request = await db.consentRequest.findUnique({ where: { id: requestId } });
  expect(request!.status).toBe("APPROVED");
  expect(request!.agreementMode).toBe("LEGALLY_BINDING");

  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();

  // ── Certificate page shows the legally binding mode ─────────
  await visit(clips, `/v/${grant!.publicId}`);
  await expect(clips.getByText("Verified authentic")).toBeVisible();
  await expect(clips.getByText("Legally binding agreement")).toBeVisible();

  await clips.context().close();
  await jane.context().close();
});
