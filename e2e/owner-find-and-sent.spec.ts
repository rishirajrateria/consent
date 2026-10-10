import { test, expect } from "@playwright/test";
import { consenterBySlug, db, deleteRequests, requesterBySlug } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Every profile can ask. Nightwatch (a TV show, set up like every other
 * profile) finds Volt Energy from Find, starts a draft, sees it under
 * Requests → Sent and on Home, then sends it. Volt is free to ask, so it is
 * sent at once. Jane, a person, can ask from Find too, and never sees an Ask
 * button on her own profile.
 */
test("a profile asks from Find and sees the request under Requests → Sent", async ({ browser }) => {
  const volt = await consenterBySlug("volt-energy");
  const nightwatchSender = await requesterBySlug("nightwatch-series");
  // A retried run starts clean: nothing from Nightwatch to Volt yet.
  await deleteRequests({ requesterId: nightwatchSender.id, consenterId: volt.id });

  // ── Jane: Find shows "Ask for permission" on others, never on herself ──
  const jane = await pageFor(browser, "jane");
  await visit(jane, "/find?q=Nightwatch");
  await expect(jane.getByRole("link", { name: "Nightwatch (TV series)" })).toBeVisible();
  await expect(
    jane.locator('form:has(input[name="consenter"][value="nightwatch-series"])').getByRole("button", { name: "Ask for permission" }),
  ).toBeVisible();
  // One profile: no "You ask as" line, and nothing to set up first.
  await expect(jane.getByText("You ask as")).toHaveCount(0);
  await expect(jane.getByText(/set up your asking profile/i)).toHaveCount(0);
  await visit(jane, "/find?q=Jane");
  await expect(jane.getByText("This is your profile.")).toBeVisible();
  await expect(jane.locator('form:has(input[name="consenter"][value="jane-carter"])')).toHaveCount(0);
  await jane.context().close();

  // ── Nightwatch: Find from the bottom bar, then ask Volt ─────
  const show = await pageFor(browser, "show");
  await visit(show, "/c-panel");
  await expect(show.getByRole("heading", { name: "Your requests" })).toBeVisible();
  await expect(show.getByText("You haven't asked anyone yet.", { exact: false }).first()).toBeVisible();
  await show.getByRole("link", { name: "Find", exact: true }).first().click();
  await show.waitForURL(/\/find/);
  await show.getByLabel("Search people").fill("Volt");
  await show.getByRole("button", { name: "Search" }).click();
  await show.waitForURL(/\/find\?q=Volt/);
  await expect(show.getByRole("link", { name: "Volt Energy" })).toBeVisible();
  await expect(show.getByText("Free to ask").first()).toBeVisible();
  await show
    .locator('form:has(input[name="consenter"][value="volt-energy"])')
    .getByRole("button", { name: "Ask for permission" })
    .click();
  await show.waitForURL(/\/r-panel\/requests\/[^/?#]+\/edit/);

  const draft = await db.consentRequest.findFirstOrThrow({
    where: { requesterId: nightwatchSender.id, consenterId: volt.id },
  });
  expect(draft.status).toBe("DRAFT");

  // ── Home points to the unfinished request; Sent lists it ────
  await visit(show, "/c-panel");
  await expect(show.getByText("Nothing sent yet. Finish your draft and send it.")).toBeVisible();
  await show.getByRole("link", { name: "1 unfinished request" }).click();
  await show.waitForURL(/\/c-panel\/requests\?tab=Sent/);
  await expect(
    show.getByRole("navigation", { name: "Requests" }).getByRole("link", { name: /^Sent/ }),
  ).toHaveAttribute("aria-current", "page");
  await expect(show.getByText("Nothing sent yet.", { exact: true })).toBeVisible();
  await expect(show.getByText("Not sent yet. Finish it and send it.")).toBeVisible();
  await show.getByRole("link", { name: `Open request #${draft.number} to Volt Energy` }).click();
  await show.waitForURL(new RegExp(`/r-panel/requests/${draft.id}/edit`));

  // ── Send it (free: no checkout) ─────────────────────────────
  const sentId = await submitBasicRequest(show, {
    slug: "volt-energy",
    query: "Volt",
    formats: [{ platform: "Instagram", format: "Reel", durationSec: 15 }],
    assetTypes: ["Logo/trademark"],
    uploadAsset: true,
    intent: "Review",
    charge: "free",
  });
  // Asking again opened the same draft.
  expect(sentId).toBe(draft.id);
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: draft.id } }))?.status)
    .toBe("PENDING");

  // ── Home and Sent show it with whose move it is ─────────────
  await visit(show, "/c-panel");
  await expect(show.getByText("Waiting for Volt Energy to answer.").first()).toBeVisible();
  await visit(show, "/c-panel/requests?tab=Sent");
  await expect(show.getByText("Waiting for Volt Energy to answer.").first()).toBeVisible();
  await show.getByRole("link", { name: `Open request #${draft.number} to Volt Energy` }).click();
  await show.waitForURL((url) => url.pathname === `/r-panel/requests/${draft.id}`);
  await expect(show.getByText("Pending", { exact: true }).first()).toBeVisible();

  // Volt sees it under Received like any other request.
  const received = await db.consentRequest.findUniqueOrThrow({ where: { id: draft.id }, include: { requester: true } });
  expect(received.requester.consenterId).toBe((await consenterBySlug("nightwatch-series")).id);

  await show.context().close();
});
