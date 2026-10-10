import { test, expect } from "@playwright/test";
import { db } from "./db";
import { pageFor, submitBasicRequest, visit } from "./helpers";

/**
 * Ask, contact choices and meetings: the Nightwatch owner Asks a question,
 * Acme Clips answers in writing, and the owner sees both above the decision.
 * The owner then approves sharing only their email and schedules a video
 * meeting: Acme sees just that email and the meeting, and each side gets its
 * own calendar invite that lists only them.
 */
test("Ask and answer, approve sharing only email, and a meeting in both calendars", async ({ browser }) => {
  const stamp = Date.now();
  const clips = await pageFor(browser, "clips");
  const show = await pageFor(browser, "show");
  show.on("dialog", (d) => d.accept());

  const requestId = await submitBasicRequest(clips, {
    slug: "nightwatch-series",
    query: "Nightwatch",
    formats: [{ platform: "YouTube", format: "Long video", durationSec: 30 }],
    assetTypes: ["Character/show footage"],
    uploadAsset: true,
    uploadRaw: true,
    intent: "Review",
  });

  // ── Owner Asks ───────────────────────────────────────────────
  const question = `E2E ${stamp}: can you keep the clip under 20 seconds?`;
  await visit(show, `/c-panel/requests/${requestId}`);
  await expect(show.getByRole("heading", { name: "Messages" })).toHaveCount(0);
  await show.getByRole("radio", { name: "Ask" }).click();
  await show.fill('textarea[name="note"]', question);
  await show.getByRole("button", { name: "Send", exact: true }).click();
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: requestId } }))!.status)
    .toBe("CHANGES_REQUESTED");

  // ── Requester answers in writing ─────────────────────────────
  const answer = `E2E ${stamp}: yes, we'll cut it to 18 seconds.`;
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText(question).first()).toBeVisible();
  await clips.fill('textarea[name="answer"]', answer);
  await clips.getByRole("button", { name: "Send answer" }).click();
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: requestId } }))!.status)
    .toBe("PENDING");

  // ── Owner sees the question and answer, approves with email only + a meeting ──
  await visit(show, `/c-panel/requests/${requestId}`);
  await expect(show.getByText("You asked:").first()).toBeVisible();
  await expect(show.getByText(answer).first()).toBeVisible();
  // The approve form (the Meeting card further down has its own schedule form).
  const approve = show.locator("form", { has: show.locator('input[name="scheduleMeeting"]') });
  await approve.locator('input[name="shareContacts"]').check();
  for (const box of await approve.locator('input[name="shareField"]').all()) {
    if ((await box.getAttribute("value")) === "email") await box.check();
    else if (await box.isEnabled()) await box.uncheck();
  }
  await approve.locator('input[name="scheduleMeeting"]').check();
  const inTwoDays = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  await approve.locator('input[name="meeting_date"]').fill(inTwoDays);
  await approve.locator('input[name="meeting_time"]').fill("15:00");
  const link = approve.locator('input[name="meeting_link"]');
  if (await link.count()) await link.first().fill("https://meet.example/e2e-call");
  await approve.getByRole("button", { name: /^Approve/ }).click();
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: requestId } }))!.contactsRevealed)
    .toBe(true);

  const request = await db.consentRequest.findUnique({ where: { id: requestId } });
  const snap = request!.contactsSnapshot as { consenter: { email: string | null; manager: string | null } };
  expect(snap.consenter.email).toBe("licensing@nightwatch.example");
  expect(snap.consenter.manager).toBeNull();

  // The meeting is booked just after the contacts are shared, so wait for it too.
  await expect
    .poll(async () => db.requestMeeting.count({ where: { requestId, status: "SCHEDULED" } }))
    .toBe(1);
  const meeting = await db.requestMeeting.findFirst({ where: { requestId, status: "SCHEDULED" } });
  expect(meeting).toBeTruthy();

  // ── Each side gets its own invite that lists only them ───────
  const inviteWhere = { body: { contains: `UID:${meeting!.id}@consent.app` } };
  await expect.poll(async () => db.outboxMessage.count({ where: inviteWhere })).toBeGreaterThanOrEqual(2);
  const invites = await db.outboxMessage.findMany({ where: inviteWhere });
  const ownerInvite = invites.find((m) => m.to === "licensing@nightwatch.example");
  const clipsInvite = invites.find((m) => m.to === "casey@acmeclips.example");
  expect(ownerInvite).toBeTruthy();
  expect(clipsInvite).toBeTruthy();
  expect(clipsInvite!.body.replace(/\r\n /g, "")).not.toContain("licensing@nightwatch.example");

  // ── Requester sees only the shared email, and the meeting ────
  await visit(clips, `/r-panel/requests/${requestId}`);
  await expect(clips.getByText("licensing@nightwatch.example").first()).toBeVisible();
  await expect(clips.getByText("nina@nightwatch.example")).toHaveCount(0);
  await expect(clips.getByRole("link", { name: /Add to Google Calendar/ }).first()).toBeVisible();

  await clips.context().close();
  await show.context().close();
});
