import { test, expect } from "@playwright/test";
import { consenterBySlug, requesterBySlug, db } from "./db";
import { pageFor, visit } from "./helpers";

/**
 * Request limits: Volt Energy accepts at most one request waiting for an
 * answer. With one already waiting, Acme Clips sees why on the search, can
 * only start a draft, and can't pay to send it until Volt answers.
 */
test("a full inbox pauses new requests before anyone pays", async ({ browser }) => {
  const volt = await consenterBySlug("volt-energy");
  const dailyLens = await requesterBySlug("daily-lens-news");
  const waiting = await db.consentRequest.create({
    data: {
      requesterId: dailyLens.id,
      consenterId: volt.id,
      status: "PENDING",
      selections: [],
      assetTypeIds: [],
      assetTypeNames: [],
      context: "E2E request waiting for Volt's answer",
      creativePlan: "E2E request waiting for Volt's answer",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(),
    },
  });
  const open = await db.consentRequest.count({ where: { consenterId: volt.id, status: { in: ["SUBMITTED", "PENDING"] } } });
  await db.consenterProfile.update({ where: { id: volt.id }, data: { maxOpenRequests: open } });

  const clips = await pageFor(browser, "clips");
  try {
    await visit(clips, "/r-panel/new?q=Volt");
    await expect(clips.getByText(/has paused new requests until they answer/).first()).toBeVisible();
    await clips.locator('form:has(input[name="consenter"][value="volt-energy"]) button').click();
    await clips.waitForURL(/\/r-panel\/requests\/[^/?#]+\/edit/);
    await expect(clips.getByText(/has paused new requests until they answer/).first()).toBeVisible();
    await expect(clips.getByRole("button", { name: /& submit/ })).toBeDisabled();
  } finally {
    await db.consenterProfile.update({ where: { id: volt.id }, data: { maxOpenRequests: null } });
    await db.consentRequest.delete({ where: { id: waiting.id } });
    await clips.context().close();
  }
});
