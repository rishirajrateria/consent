import { test, expect } from "@playwright/test";
import { db, deleteRequests, latestOtp, requesterBySlug } from "./db";
import { pageFor, totpCode, visit } from "./helpers";

/** A 1×1 transparent PNG, for the profile photo. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * Account onboarding, the same for everyone: sign up, verify the email and
 * the phone (codes read from the DB), set up 2FA (required for every
 * account), fill in the one ID check form, and send it. The admin approves
 * it once, and the new profile can then both ask others and be asked.
 * Membership is free for now, so nothing is paid on the way.
 */
test("a new account gets verified once and can then both ask and be asked", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e-acct-${stamp}@example.com`;
  const phone = `+1555${stamp.slice(-8)}`;
  const display = `E2E Person ${stamp}`;
  const legal = `E2E Legal Person ${stamp}`;

  // ── Sign up + email code ─────────────────────────────────────
  await visit(page, "/signup");
  await page.fill('input[name="name"]', "E2E Person");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="phone"]', phone);
  await page.fill('input[name="password"]', "Password1!");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify-email/);

  await page.fill('input[name="code"]', await latestOtp(email, "EMAIL_VERIFY"));
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.waitForURL(/\/verify-phone/);

  // ── Phone code (the ID check needs a verified phone) ─────────
  await expect(page.getByRole("button", { name: "Skip for now" })).toHaveCount(0);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.waitForURL(/\/verify-phone\?.*sent=1/);
  await page.fill('input[name="code"]', await latestOtp(email, "PHONE_VERIFY"));
  await page.getByRole("button", { name: "Verify phone" }).click();

  // ── 2FA, required for every account, then on to the ID check ──
  await page.waitForURL(/\/settings\/security\?.*next=(%2F|\/)onboarding/);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByText("Finish this setup to continue. It takes a minute.")).toBeVisible();
  // The page made a pending secret for this setup; the "app" reads it here.
  await expect
    .poll(async () => (await db.user.findUnique({ where: { email } }))?.totpSecret ?? null)
    .not.toBeNull();
  const secret = (await db.user.findUniqueOrThrow({ where: { email } })).totpSecret!;
  await page.fill('input[name="code"]', await totpCode(secret));
  await page.getByRole("button", { name: "Enable 2FA" }).click();
  await page.waitForURL((url) => url.pathname === "/onboarding");
  await page.waitForLoadState("networkidle").catch(() => {});

  // ── The one ID check form: every field but "Also known as" ───
  await expect(page.getByRole("heading", { name: "Get verified", exact: true })).toBeVisible();
  await page.selectOption('select[name="entityType"]', "PERSON");
  // The creator type follows the kind of profile.
  await expect(page.locator('select[name="creatorType"]')).toHaveValue("INDIVIDUAL_CREATOR");
  await page.selectOption('select[name="country"]', "US");
  await page.fill('input[name="legalName"]', legal);
  await page.fill('input[name="displayName"]', display);
  await page.fill('input[name="category"]', "Comedian and podcast host");
  await page.fill(
    'textarea[name="bio"]',
    "Stand-up comedian and weekly podcast host. This profile was made by the automated e2e onboarding test.",
  );
  await page.locator('input[name="photo"]').setInputFiles({ name: `e2e-photo-${stamp}.png`, mimeType: "image/png", buffer: PNG });
  await page.getByLabel("Channel 1 platform").fill("YouTube");
  await page.getByLabel("Channel 1 link").fill(`https://youtube.com/@e2e-${stamp}`);
  await page.getByLabel("Channel 1 followers").fill("12345");
  // Fee: free to ask. Limit: unlimited. Both are an explicit choice.
  await page.locator('label:has(input[name="feeMode"][value="free"])').click();
  await page.locator('label:has(input[name="limitKind"][value="unlimited"])').click();
  await page.selectOption('select[name="documentType"]', "Passport");
  await page.fill('input[name="documentNumber"]', `E2E${stamp}`);
  await page.locator('input[name="document"]').setInputFiles({
    name: `e2e-passport-${stamp}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from(`%PDF-1.4 E2E passport ${stamp}`),
  });
  await page.locator('input[name="declaration"]').check();
  await page.getByRole("button", { name: "Send for ID check" }).click();

  await page.waitForURL(/\/onboarding\?.*submitted=1/);
  await expect(page.getByText("Sent for ID check. We'll tell you here and by email when it's done.")).toBeVisible();
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();

  // One profile, both halves, waiting for the one ID check.
  const profile = await db.consenterProfile.findFirstOrThrow({ where: { displayName: display } });
  expect(profile.status).toBe("SUBMITTED");
  expect(profile.consentPrice).toBeNull();
  const sender = await db.requesterProfile.findUniqueOrThrow({ where: { consenterId: profile.id } });
  expect(sender.status).toBe("SUBMITTED");
  expect(sender.type).toBe("INDIVIDUAL_CREATOR");

  // ── The admin approves it once ───────────────────────────────
  const admin = await pageFor(browser, "admin");
  await visit(admin, `/admin/consenters/${profile.id}`);
  await expect(admin.getByRole("heading", { name: display })).toBeVisible();
  await admin.getByRole("button", { name: "Approve", exact: true }).click();
  await admin.waitForURL(/done=decided/);
  await expect(admin.getByText("Saved. The applicant was told.")).toBeVisible();
  await admin.context().close();

  // Both halves are verified by that one approval.
  await expect
    .poll(async () => (await db.consenterProfile.findUniqueOrThrow({ where: { id: profile.id } })).status)
    .toBe("APPROVED");
  await expect
    .poll(async () => (await db.requesterProfile.findUniqueOrThrow({ where: { id: sender.id } })).status)
    .toBe("APPROVED");

  // ── The new profile is live; membership is free for now ──────
  await visit(page, `/onboarding?profile=${profile.id}`);
  await expect(page.getByRole("link", { name: /^Go to Home/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Pay membership/ })).toHaveCount(0);

  // It can ask: Find offers "Ask for permission" on someone else.
  await visit(page, "/find?q=Volt");
  await expect(
    page.locator('form:has(input[name="consenter"][value="volt-energy"])').getByRole("button", { name: "Ask for permission" }),
  ).toBeVisible();

  // It can be asked: Daily Lens News finds it (free to ask) and starts a request to it.
  const news = await pageFor(browser, "news");
  const dailyLens = await requesterBySlug("daily-lens-news");
  try {
    await visit(news, `/find?q=${encodeURIComponent(display)}`);
    await expect(news.getByRole("link", { name: display })).toBeVisible();
    const card = news.locator(`form:has(input[name="consenter"][value="${profile.slug}"])`);
    await card.getByRole("button", { name: "Ask for permission" }).click();
    await news.waitForURL(/\/r-panel\/requests\/[^/?#]+\/edit/);
    const draft = await db.consentRequest.findFirstOrThrow({
      where: { requesterId: dailyLens.id, consenterId: profile.id },
    });
    expect(draft.status).toBe("DRAFT");
    await expect(news.getByRole("button", { name: "Send request" })).toBeVisible();
  } finally {
    await deleteRequests({ requesterId: dailyLens.id, consenterId: profile.id });
    await news.context().close();
  }
});
