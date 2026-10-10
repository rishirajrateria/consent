import { test, expect } from "@playwright/test";
import { consenterBySlug, db } from "./db";
import { pageFor, visit } from "./helpers";

/**
 * Owners can ask too. Find sits in the owner's bottom bar: someone with no
 * asking profile is shown how to set one up; someone with one asks straight
 * from the search, and the request shows under Requests → Sent and on Home.
 */
test("an owner finds someone, asks them, and sees it under Sent", async ({ browser }) => {
  // Jane only owns a profile, so Find shows how to start asking.
  const jane = await pageFor(browser, "jane");
  await visit(jane, "/c-panel");
  await jane.getByRole("link", { name: "Find" }).first().click();
  await jane.waitForURL(/\/find/);
  await jane.getByLabel("Search people").fill("Volt");
  await jane.getByRole("button", { name: "Search" }).click();
  await jane.waitForURL(/\/find\?q=Volt/);
  await expect(jane.getByRole("link", { name: "Volt Energy" })).toBeVisible();
  await expect(jane.getByText(/set up your asking profile first/).first()).toBeVisible();
  await expect(jane.getByRole("link", { name: "Set up your asking profile" }).first()).toHaveAttribute("href", "/onboarding/requester");

  await visit(jane, "/find?q=Jane");
  await expect(jane.getByText("This is your profile.")).toBeVisible();

  await visit(jane, "/c-panel/requests?tab=Sent");
  await expect(jane.getByText("You haven't asked anyone yet.")).toBeVisible();
  await expect(jane.getByRole("link", { name: /Find someone to ask/ })).toHaveAttribute("href", "/find");

  // Nina owns Nightwatch and also has an approved asking profile.
  const nightwatch = await consenterBySlug("nightwatch-series");
  const nina = await db.user.findUniqueOrThrow({ where: { email: "show@demo.consent" } });
  const year = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const asking = await db.requesterProfile.create({
    data: {
      slug: `nightwatch-studio-e2e-${Date.now()}`,
      displayName: "Nightwatch Studio",
      legalName: "Nightwatch Studio LLC",
      type: "MEDIA_HOUSE",
      country: "US",
      description: "E2E asking profile for an owner.",
      categories: ["entertainment"],
      channels: [],
      status: "APPROVED",
      approvedAt: new Date(),
      onboardingFeePaidAt: new Date(),
      subscriptionEndsAt: year,
      contactEmail: "studio@nightwatch.example",
      score: 700,
      members: { create: { userId: nina.id, role: "OWNER" } },
    },
  });

  const show = await pageFor(browser, "show");
  try {
    await visit(show, "/c-panel");
    await expect(show.getByText("Requests you've made")).toBeVisible();
    await show.getByRole("link", { name: "Find" }).first().click();
    await show.waitForURL(/\/find/);
    await show.getByLabel("Search people").fill("Jane");
    await show.getByRole("button", { name: "Search" }).click();
    await show.waitForURL(/\/find\?q=Jane/);
    await expect(show.getByText("You ask as")).toContainText("Nightwatch Studio");
    await show.locator('form:has(input[name="consenter"][value="jane-carter"])').getByRole("button", { name: "Ask for permission" }).click();
    await show.waitForURL(/\/r-panel\/requests\/[^/?#]+\/edit/);

    const draft = await db.consentRequest.findFirstOrThrow({
      where: { requesterId: asking.id },
      include: { consenter: true },
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.consenter.slug).toBe("jane-carter");

    // Back in the owner workspace, Home points to the unfinished request and Sent lists it.
    await visit(show, "/c-panel");
    await expect(show.getByText("Nothing sent yet. Finish your draft and send it.")).toBeVisible();
    await show.getByRole("link", { name: "1 unfinished request" }).click();
    await show.waitForURL(/\/c-panel\/requests\?tab=Sent/);
    await expect(show.getByRole("link", { name: "Sent", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(show.getByText("Nothing sent yet.", { exact: true })).toBeVisible();
    await expect(show.getByText("Not sent yet. Finish it and send it.")).toBeVisible();
    await show.getByRole("button", { name: `Open request #${draft.number} to Jane Carter` }).click();
    await show.waitForURL(new RegExp(`/r-panel/requests/${draft.id}/edit`));

    // Once sent, Home shows it with whose move it is, and it opens the request.
    await db.consentRequest.update({ where: { id: draft.id }, data: { status: "PENDING", submittedAt: new Date() } });
    await visit(show, "/c-panel");
    await expect(show.getByText("Waiting for Jane Carter to answer.")).toBeVisible();
    await show.getByRole("button", { name: `Open request #${draft.number} to Jane Carter` }).click();
    await show.waitForURL(new RegExp(`/r-panel/requests/${draft.id}$`));
  } finally {
    await db.consentRequest.deleteMany({ where: { requesterId: asking.id } });
    await db.session.updateMany({
      where: { userId: nina.id, activeProfile: `requester:${asking.id}` },
      data: { activeProfile: `consenter:${nightwatch.id}` },
    });
    await db.requesterProfile.delete({ where: { id: asking.id } });
  }
});
