"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { storeUpload } from "@/lib/storage";
import { resolveSide } from "./shared-actions";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";

function panelPath(side: "consenter" | "requester", id: string) {
  return side === "consenter" ? `/c-panel/requests/${id}` : `/r-panel/requests/${id}`;
}

export async function fileReportAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side } = await resolveSide(id);
  const path = panelPath(side, id);
  const reason = String(formData.get("reason") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  if (!reason || description.length < 20)
    redirect(`${path}?error=${encodeURIComponent("Pick a reason and describe the breach (min 20 characters)")}`);

  const links = String(formData.get("links") ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const evidenceFileIds: string[] = [];
  const evidence = formData.get("evidence") as File | null;
  if (evidence && evidence.size > 0) {
    const stored = await storeUpload({
      file: evidence,
      kind: "EVIDENCE",
      uploadedById: session.userId,
      requestId: id,
    });
    evidenceFileIds.push(stored.id);
  }

  await db.report.create({
    data: { requestId: id, bySide: side, reason, description, evidenceLinks: links, evidenceFileIds },
  });
  await db.requestEvent.create({
    data: { requestId: id, type: "report_filed", actorName: session.user.name, actorSide: side, detail: { reason } },
  });
  const notify = side === "consenter" ? notifyRequesterTeam : notifyConsenterTeam;
  await notify(side === "consenter" ? request.requesterId : request.consenterId, {
    title: `A report was filed on request #${request.number}`,
    body: `Category: ${reason}. You can submit a response; the Consent team will review.`,
    href: panelPath(side === "consenter" ? "requester" : "consenter", id),
    critical: true,
  });
  redirect(`${path}?reported=1`);
}

export async function respondReportAction(formData: FormData) {
  const reportId = String(formData.get("reportId"));
  const report = await db.report.findUnique({ where: { id: reportId }, include: { request: true } });
  if (!report) redirect("/dashboard");
  const { session, side } = await resolveSide(report.requestId);
  const path = panelPath(side, report.requestId);
  if (report.bySide === side) redirect(`${path}?error=${encodeURIComponent("You filed this report")}`);
  const response = String(formData.get("response") ?? "").trim();
  if (!response) redirect(`${path}?error=${encodeURIComponent("Write a response")}`);
  await db.report.update({ where: { id: reportId }, data: { response } });
  await db.requestEvent.create({
    data: { requestId: report.requestId, type: "report_response", actorName: session.user.name, actorSide: side },
  });
  redirect(`${path}`);
}
