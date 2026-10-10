import { test, expect } from "@playwright/test";
import { db, grantForRequest } from "./db";
import { expectStatus, pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Ask and answer: the Nightwatch owner Asks a question instead of deciding,
 * Acme Clips answers in writing, and the owner sees both right above the
 * decision, then approves. That is the whole conversation: no contact
 * details are shared and no meeting is set up.
 */
test("the owner asks, the asker answers in writing, then the owner approves", async ({ browser }) => {
  const stamp = Date.now();
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");

  const requestId = await submitBasicRequest(clips, {
    slug: "nightwatch-series",
    query: "Nightwatch",
    formats: [{ platform: "YouTube", format: "Long video", durationSec: 30 }],
    assetTypes: ["Character/show footage"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Review",
    charge: "paid",
  });
  await expectStatus(requestId, "PENDING");

  // ── Owner Asks ───────────────────────────────────────────────
  const question = `E2E ${stamp}: can you keep the clip under 20 seconds?`;
  await visit(show, `/c-panel/requests/${requestId}`);
  await show.getByRole("radio", { name: "Ask" }).click();
  await show.fill('textarea[name="note"]', question);
  await show.getByRole("button", { name: "Send", exact: true }).click();
  await expectStatus(requestId, "CHANGES_REQUESTED");

  // ── The asker answers in writing ─────────────────────────────
  const answer = `E2E ${stamp}: yes, we'll cut it to 18 seconds.`;
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText("Question asked", { exact: true }).first()).toBeVisible();
  await expect(clips.getByText(question).first()).toBeVisible();
  await clips.fill('textarea[name="answer"]', answer);
  await clips.getByRole("button", { name: "Send answer" }).click();
  await expectStatus(requestId, "PENDING");
  await expect
    .poll(async () => db.requestEvent.count({ where: { requestId, type: "ask_answered" } }))
    .toBe(1);

  // ── The owner sees the question and the answer, then approves ──
  await visit(show, `/c-panel/requests/${requestId}`);
  await expect(show.getByText("You asked:").first()).toBeVisible();
  await expect(show.getByText("They answered:").first()).toBeVisible();
  await expect(show.getByText(answer).first()).toBeVisible();
  // No contact sharing or meeting choices anywhere in the answer.
  for (const gone of [/Share my contact details/i, /schedule a meeting/i, /Set a fee/, /counter-offer/i]) {
    await expect(show.getByText(gone)).toHaveCount(0);
  }
  await show.getByRole("button", { name: /^Approve/ }).click();
  await expectStatus(requestId, "APPROVED");
  await expect.poll(async () => (await grantForRequest(requestId))?.status).toBe("ACTIVE");

  // Only the plain events of a decision: nothing shared, nothing booked.
  const events = await db.requestEvent.findMany({ where: { requestId }, select: { type: true } });
  const types = events.map((e) => e.type);
  expect(types).toEqual(expect.arrayContaining(["submitted", "changes_requested", "ask_answered", "approved"]));
  expect(types.filter((t) => /contact|meeting|offer|deal|agreement/.test(t))).toEqual([]);

  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByRole("heading", { name: "Certificate", exact: true })).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
