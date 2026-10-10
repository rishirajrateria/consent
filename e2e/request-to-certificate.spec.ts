import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Flow 2 — request to certificate: Acme Clips asks Nightwatch (asset + raw
 * uploads, two checkout lines because Nightwatch has a consent price), the
 * show owner marks it paid at $500, clips counter-offers $300, the show
 * accepts (deal agreed, contacts revealed), clips continues with the
 * Consent-app record and the public /v page verifies the certificate.
 */
test("negotiated request ends in a verified certificate", async ({ browser }) => {
  const clips = await pageFor(browser, "clips");
  const requestId = await submitBasicRequest(clips, {
    slug: "nightwatch-series",
    query: "Nightwatch",
    formats: [{ platform: "YouTube", format: "Long video", durationSec: 45 }],
    assetTypes: ["Character/show footage"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Review",
  });
  await expect(clips.getByText("Pending", { exact: true }).first()).toBeVisible();

  // ── Show owner reads the request, then sets a fee of $500 ───
  // Note: this action redirects to the same path plus a #hash, which the
  // app router treats as a hash-only navigation (no re-render), so the
  // state change is awaited in the DB and the page reloaded.
  const show = await pageFor(browser, "show");
  await visit(show, `/c-panel/requests/${requestId}`);
  await show.getByRole("radio", { name: "Set a fee" }).click();
  await show.fill('input[name="amount"]', "500");
  await show.getByRole("button", { name: "Send fee" }).click();
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: requestId } }))!.status)
    .toBe("IN_NEGOTIATION");
  await visit(show, `/c-panel/requests/${requestId}`);
  await expect(show.getByText("In negotiation", { exact: true }).first()).toBeVisible();

  // ── Clips counter-offers $300 ───────────────────────────────
  await visit(clips, `/r-panel/requests/${requestId}`);
  const negotiation = clips.locator("#negotiation");
  await expect(negotiation.getByRole("button", { name: /^Accept/ })).toBeVisible();
  await expect(negotiation.getByText(/you 3 of 3/)).toBeVisible();
  await negotiation.getByRole("radio", { name: "Counter-offer" }).click();
  await negotiation.locator('input[name="amount"]').fill("300");
  await negotiation.getByRole("button", { name: "Send counter-offer" }).click();
  await expect
    .poll(async () =>
      (await db.negotiationOffer.findFirst({ where: { requestId, version: 2 } }))?.bySide
    )
    .toBe("requester");
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText("by Casey Clips (requester)")).toBeVisible();
  await expect(clips.locator("#negotiation").getByText(/you 2 of 3/)).toBeVisible();

  // ── Show owner accepts → deal agreed, contacts revealed ─────
  await visit(show, `/c-panel/requests/${requestId}`);
  await show.getByRole("button", { name: /^Accept/ }).click();
  await expect(show.getByText("Shared contact details")).toBeVisible();
  await expect(show.getByText("Agreement mode pending", { exact: true }).first()).toBeVisible();

  const agreed = await db.consentRequest.findUnique({ where: { id: requestId } });
  expect(agreed!.status).toBe("AGREEMENT_MODE_PENDING");
  expect(agreed!.contactsRevealed).toBe(true);
  expect(Number(agreed!.agreedAmount)).toBe(300);

  // ── Requester continues with the Consent-app record → grant ─
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText("Shared contact details")).toBeVisible();
  await clips.getByRole("button", { name: "Continue with Consent-app record" }).click();
  await expect(clips.getByText("Consent grant")).toBeVisible();

  const grant = await grantForRequest(requestId);
  expect(grant).toBeTruthy();
  expect(grant!.status).toBe("ACTIVE");

  // ── Public verification page ────────────────────────────────
  await visit(clips, `/v/${grant!.publicId}`);
  await expect(clips.getByText("Verified authentic")).toBeVisible();
  await expect(clips.getByText("Active", { exact: true })).toBeVisible();
  await expect(clips.getByText(grant!.certificateId).first()).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
