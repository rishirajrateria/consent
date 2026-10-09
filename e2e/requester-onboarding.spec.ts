import { test, expect } from "@playwright/test";
import { db, latestOtp } from "./db";
import { pageFor, visit } from "./helpers";

/**
 * Flow 1 — requester onboarding: fresh signup, email OTP from the DB, skip
 * phone, submit the requester application (channels + document upload),
 * admin approves it, applicant pays onboarding via mock checkout and lands
 * with an Active requester panel.
 */
test("fresh requester signs up, gets approved and activates", async ({ page, browser }) => {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-req-${stamp}@example.com`;
  const phone = `+1555${stamp.slice(-8)}`;
  const display = `E2E Studio ${stamp}`;

  // ── Signup + email OTP (read from the OtpCode table) ────────
  await visit(page, "/signup");
  await page.fill('input[name="name"]', "E2E Owner");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="phone"]', phone);
  await page.fill('input[name="password"]', "Password1!");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify-email/);

  const code = await latestOtp(email, "EMAIL_VERIFY");
  await page.fill('input[name="code"]', code);
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.waitForURL(/\/verify-phone/);

  // ── Skip phone verification ─────────────────────────────────
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.waitForURL(/\/dashboard/);

  // ── Submit the requester application ────────────────────────
  await visit(page, "/onboarding/requester");
  await page.fill('input[name="legalName"]', `${display} LLC`);
  await page.fill('input[name="displayName"]', display);
  // keep defaults: type Individual Creator, country US
  await page.fill('textarea[name="description"]', "We make daily automated e2e commentary clips about entertainment news for testing.");
  await page.locator('input[name="channelPlatform"]').first().fill("YouTube");
  await page.locator('input[name="channelUrl"]').first().fill(`https://youtube.com/@e2e-${stamp}`);
  await page.locator('input[name="channelFollowers"]').first().fill("12345");
  await page.locator('input[name="document"]').setInputFiles({
    name: `e2e-registration-${stamp}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`E2E business registration document ${stamp}`),
  });
  await page.getByRole("button", { name: "Submit application" }).click();
  await page.waitForURL(/submitted=1/);
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();

  // ── Admin approves the application ──────────────────────────
  const profile = await db.requesterProfile.findFirst({ where: { displayName: display } });
  expect(profile).toBeTruthy();

  const admin = await pageFor(browser, "admin");
  await visit(admin, `/admin/requesters/${profile!.id}`);
  await expect(admin.getByRole("heading", { name: display })).toBeVisible();
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.waitForURL(/done=1/);
  await expect(admin.getByText("Approved", { exact: true })).toBeVisible();
  await admin.context().close();

  // ── Applicant pays onboarding via mock checkout ─────────────
  await visit(page, "/onboarding/requester");
  await expect(page.getByText(/activate your account/)).toBeVisible();
  await page.getByRole("button", { name: "Pay and activate" }).click();
  await page.waitForURL(/\/pay\/mock\//);
  await page.getByRole("button", { name: /^Pay/ }).click();
  await page.waitForURL(/\/r-panel/);

  // ── Requester panel shows Active ────────────────────────────
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  const activated = await db.requesterProfile.findUnique({ where: { id: profile!.id } });
  expect(activated!.status).toBe("APPROVED");
  expect(activated!.onboardingFeePaidAt).not.toBeNull();
});
