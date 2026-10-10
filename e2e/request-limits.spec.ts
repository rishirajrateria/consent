import { test, expect } from "@playwright/test";
import { consenterBySlug, deleteRequests, requesterBySlug, db } from "./db";
import { pageFor, sendButton, visit } from "./helpers";

/**
 * Request limits: Volt Energy accepts at most as many requests waiting for
 * an answer as it has now. With that many already waiting, Acme Clips sees
 * why on Find, can only start a draft, and can't send it until Volt answers.
 */
test("a full inbox pauses new requests before anything is sent", async ({ browser }) => {
  const volt = await consenterBySlug("volt-energy");
  const dailyLens = await requesterBySlug("daily-lens-news");
  const acme = await requesterBySlug("acme-clips");
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
  // Waiting for Volt's first answer: the same count the limit uses.
  const open = await db.consentRequest.count({ where: { consenterId: volt.id, status: { in: ["SUBMITTED", "PENDING"] } } });
  await db.consenterProfile.update({ where: { id: volt.id }, data: { maxOpenRequests: open } });

  const clips = await pageFor(browser, "clips");
  try {
    await visit(clips, "/find?q=Volt");
    const card = clips.locator('form:has(input[name="consenter"][value="volt-energy"])');
    await expect(clips.getByText(/has paused new requests until they answer/).first()).toBeVisible();
    await expect(card.getByRole("button", { name: "Start a draft" })).toBeVisible();
    await card.getByRole("button", { name: "Start a draft" }).click();
    await clips.waitForURL(/\/r-panel\/requests\/[^/?#]+\/edit/);
    await expect(clips.getByText(/has paused new requests until they answer/).first()).toBeVisible();
    // Volt is free to ask, so the one button is "Send request", and it stays off.
    await expect(sendButton(clips)).toHaveText("Send request");
    await expect(sendButton(clips)).toBeDisabled();
  } finally {
    await db.consenterProfile.update({ where: { id: volt.id }, data: { maxOpenRequests: null } });
    await db.consentRequest.delete({ where: { id: waiting.id } });
    // The draft Acme Clips started here (never sent).
    const drafts = await db.consentRequest.findMany({
      where: { requesterId: acme.id, consenterId: volt.id, status: "DRAFT" },
      select: { id: true },
    });
    await deleteRequests({ ids: drafts.map((d) => d.id) });
    await clips.context().close();
  }
});
