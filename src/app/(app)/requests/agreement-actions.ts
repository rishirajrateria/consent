"use server";

import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { issueOtp, consumeOtp } from "@/lib/auth";
import { getESignProvider } from "@/lib/esign";
import { email } from "@/lib/providers";
import { storeUpload } from "@/lib/storage";
import { issueGrant } from "@/lib/grants";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { resolveSide } from "./shared-actions";
import type { Selection } from "@/lib/rules";
import { fmtMoney } from "@/lib/utils";

function panelPath(side: "consenter" | "requester", id: string) {
  return side === "consenter" ? `/c-panel/requests/${id}` : `/r-panel/requests/${id}`;
}
function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

async function notifyOther(side: "consenter" | "requester", request: { id: string; number: number; consenterId: string; requesterId: string }, title: string, body: string) {
  const other = side === "consenter" ? "requester" : "consenter";
  const notify = other === "consenter" ? notifyConsenterTeam : notifyRequesterTeam;
  await notify(other === "consenter" ? request.consenterId : request.requesterId, {
    title,
    body,
    href: panelPath(other, request.id),
    critical: true,
  });
}

export async function proposeLegalAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side } = await resolveSide(id);
  const path = panelPath(side, id);
  if (request.status !== "AGREEMENT_MODE_PENDING") fail(path, "Agreement mode is not open");
  await db.agreement.upsert({
    where: { requestId: id },
    update: { status: "PROPOSED", proposedBySide: side, kind: null },
    create: { requestId: id, status: "PROPOSED", proposedBySide: side },
  });
  await db.consentRequest.update({ where: { id }, data: { status: "LEGAL_AGREEMENT_PENDING" } });
  await db.requestEvent.create({
    data: { requestId: id, type: "legal_agreement_proposed", actorName: session.user.name, actorSide: side },
  });
  await notifyOther(side, request, `Legally binding agreement proposed on request #${request.number}`, "The other side proposes to formalise this consent as a legally binding agreement. Accept or decline.");
  redirect(path);
}

export async function respondProposalAction(formData: FormData) {
  const id = String(formData.get("id"));
  const accept = String(formData.get("respond")) === "accept";
  const { session, request, side } = await resolveSide(id);
  const path = panelPath(side, id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (!agreement || agreement.status !== "PROPOSED") fail(path, "No open proposal");
  if (agreement.proposedBySide === side) fail(path, "The other side must respond to your proposal");

  if (accept) {
    await db.agreement.update({ where: { requestId: id }, data: { status: "DRAFTING" } });
    await db.requestEvent.create({
      data: { requestId: id, type: "legal_agreement_accepted", actorName: session.user.name, actorSide: side },
    });
    await notifyOther(side, request, `Agreement proposal accepted on request #${request.number}`, "Choose how to create the agreement: platform-generated or upload your own signed contract.");
  } else {
    await db.agreement.update({ where: { requestId: id }, data: { status: "DECLINED" } });
    await db.consentRequest.update({ where: { id }, data: { status: "AGREEMENT_MODE_PENDING" } });
    await db.requestEvent.create({
      data: { requestId: id, type: "legal_agreement_declined", actorName: session.user.name, actorSide: side },
    });
    await notifyOther(side, request, `Agreement proposal declined on request #${request.number}`, "You can continue with the Consent-app record only, or close the request.");
  }
  redirect(path);
}

function renderTemplate(body: string, request: {
  number: number;
  consenter: { legalName: string };
  requester: { legalName: string };
  approvedSelections: unknown;
  selections: unknown;
  assetTypeNames: string[];
  validityKind: string;
  validFrom: Date | null;
  validUntil: Date | null;
  conditionsNote: string | null;
  isPaid: boolean;
  agreedAmount: unknown;
  agreedCurrency: string | null;
  files: { kind: string; sha256: string; name: string }[];
}): string {
  const selections = (request.approvedSelections ?? request.selections) as Selection[];
  const scope = selections
    .map((s) => `${s.platformName} → ${s.formatName}${s.durationSec ? ` (max ${s.durationSec}s)` : ""}`)
    .join("; ");
  const validity =
    request.validityKind === "SINGLE_PUBLICATION"
      ? "Single publication"
      : request.validityKind === "PERPETUAL"
        ? "Perpetual"
        : `From ${request.validFrom?.toDateString()} to ${request.validUntil?.toDateString()}`;
  const fee = request.isPaid
    ? `${fmtMoney(String(request.agreedAmount ?? "0"), request.agreedCurrency ?? "USD")} agreed between the parties, settled directly (not through Consent)`
    : "Free of charge";
  const hashes = request.files
    .filter((f) => ["RAW_CONTENT", "ASSET", "THUMBNAIL"].includes(f.kind))
    .map((f) => `${f.kind}: ${f.name} — sha256:${f.sha256}`)
    .join("\n") || "To be bound on final file upload";
  return body
    .replaceAll("{{consenterLegalName}}", request.consenter.legalName)
    .replaceAll("{{requesterLegalName}}", request.requester.legalName)
    .replaceAll("{{date}}", new Date().toUTCString())
    .replaceAll("{{assetTypes}}", request.assetTypeNames.join(", "))
    .replaceAll("{{scope}}", scope)
    .replaceAll("{{validity}}", validity)
    .replaceAll("{{fee}}", fee)
    .replaceAll("{{conditions}}", request.conditionsNote ?? "None")
    .replaceAll("{{fileHashes}}", hashes);
}

export async function chooseAgreementKindAction(formData: FormData) {
  const id = String(formData.get("id"));
  const kind = String(formData.get("kind"));
  const { session, request, side } = await resolveSide(id);
  const path = panelPath(side, id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (!agreement || agreement.status !== "DRAFTING") fail(path, "Agreement is not in drafting state");

  if (kind === "PLATFORM_GENERATED") {
    const full = await db.consentRequest.findUniqueOrThrow({
      where: { id },
      include: { consenter: true, requester: true, files: true },
    });
    const template = await db.agreementTemplate.findFirst({
      where: { active: true, jurisdiction: { in: [full.requester.country, "GLOBAL"] } },
      orderBy: { jurisdiction: "desc" }, // country-specific first, GLOBAL fallback
    });
    if (!template) fail(path, "No agreement template is configured — contact support");
    const optional = (template.optionalClauses as { id: string; title: string; body: string }[]) ?? [];
    const chosen = formData.getAll("clauses").map(String);
    let body = renderTemplate(template.body, full);
    const extra = optional.filter((c) => chosen.includes(c.id));
    if (extra.length) {
      body += "\n\nOPTIONAL CLAUSES\n" + extra.map((c, i) => `${i + 8}. ${c.title.toUpperCase()}. ${c.body}`).join("\n");
    }
    body += `\n\n---\nDisclaimer: ${template.disclaimer}`;
    await db.agreement.update({
      where: { requestId: id },
      data: {
        kind: "PLATFORM_GENERATED",
        templateId: template.id,
        body,
        bodyVersion: agreement.bodyVersion + 1,
        status: "AWAITING_SIGNATURES",
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    });
    // editing the draft voids earlier signatures
    await db.agreementSignature.deleteMany({ where: { agreementId: agreement.id } });
    await notifyOther(side, request, `Agreement drafted for request #${request.number}`, "Review the platform-generated agreement and sign in-app.");
  } else {
    await db.agreement.update({
      where: { requestId: id },
      data: { kind: "UPLOADED", status: "UPLOAD_PENDING_CONFIRMATION" },
    });
    await notifyOther(side, request, `Own agreement chosen for request #${request.number}`, "One side uploads the fully signed contract; the other confirms it in-app.");
  }
  await db.requestEvent.create({
    data: { requestId: id, type: "agreement_drafted", actorName: session.user.name, actorSide: side, detail: { kind } },
  });
  redirect(path);
}

export async function sendSignatureOtpAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, side } = await resolveSide(id);
  const code = await issueOtp(session.userId, "SIGNATURE", session.user.email);
  const { renderMessage } = await import("@/lib/templates");
  const msg = await renderMessage("signature_otp_email", { subject: "Your Consent e-signature code", body: "Code to sign the agreement: {{code}}. It expires in 10 minutes." }, { code });
  await email.send(session.user.email, msg.subject!, msg.body);
  redirect(`${panelPath(side, id)}?otp=sent`);
}

export async function signAgreementAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side } = await resolveSide(id);
  const path = panelPath(side, id);
  const agreement = await db.agreement.findUnique({
    where: { requestId: id },
    include: { signatures: true },
  });
  if (!agreement || agreement.status !== "AWAITING_SIGNATURES") fail(path, "Agreement is not awaiting signatures");
  if (agreement.signatures.some((s) => s.side === side)) fail(path, "Your side has already signed");

  const typedName = String(formData.get("typedName") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim();
  if (typedName.length < 3) fail(path, "Type your full legal name as signature");
  const esign = await getESignProvider();
  if (!(await esign.verifySigner({ userId: session.userId, otpCode: code })))
    fail(path, "Invalid or expired signature code");

  const { headers } = await import("next/headers");
  const h = await headers();
  await db.agreementSignature.create({
    data: {
      agreementId: agreement.id,
      userId: session.userId,
      side,
      typedName,
      otpVerified: true,
      ip: h.get("x-forwarded-for") ?? undefined,
    },
  });
  await db.requestEvent.create({
    data: { requestId: id, type: "agreement_signed", actorName: session.user.name, actorSide: side, detail: { typedName } },
  });
  await audit({ actorId: session.userId, actorName: session.user.name, action: "agreement_signed", module: "agreements", targetId: agreement.id });

  const signatures = await db.agreementSignature.count({ where: { agreementId: agreement.id } });
  if (signatures >= 2) {
    await completeAgreement(id, session.user.name);
  } else {
    await notifyOther(side, request, `Agreement signed by ${side} on request #${request.number}`, "Your signature is the last step before the grant is issued.");
  }
  redirect(path);
}

export async function uploadOwnAgreementAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side } = await resolveSide(id);
  const path = panelPath(side, id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (!agreement || agreement.status !== "UPLOAD_PENDING_CONFIRMATION") fail(path, "Not awaiting an upload");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) fail(path, "Choose the fully signed agreement file");
  const stored = await storeUpload({ file, kind: "AGREEMENT", uploadedById: session.userId, requestId: id });
  await db.agreement.update({
    where: { requestId: id },
    data: { uploadedFileId: stored.id, sha256: stored.sha256, uploadConfirmedBySide: side },
  });
  await db.requestEvent.create({
    data: { requestId: id, type: "agreement_uploaded", actorName: session.user.name, actorSide: side, detail: { name: file.name } },
  });
  await notifyOther(side, request, `Signed agreement uploaded on request #${request.number}`, "Confirm in-app that this is the correct, fully signed document.");
  redirect(path);
}

export async function confirmUploadedAgreementAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, side } = await resolveSide(id);
  const path = panelPath(side, id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (!agreement || !agreement.uploadedFileId) fail(path, "No uploaded agreement to confirm");
  if (agreement.uploadConfirmedBySide === side) fail(path, "The other side must confirm the upload");
  await db.requestEvent.create({
    data: { requestId: id, type: "agreement_upload_confirmed", actorName: session.user.name, actorSide: side },
  });
  await completeAgreement(id, session.user.name);
  redirect(path);
}

async function completeAgreement(requestId: string, actorName: string) {
  await db.agreement.update({ where: { requestId }, data: { status: "COMPLETED" } });
  const request = await db.consentRequest.update({
    where: { id: requestId },
    data: { agreementMode: "LEGALLY_BINDING" },
    include: { files: true },
  });
  const hasRaw = request.files.some((f) => f.kind === "RAW_CONTENT");
  if (hasRaw) {
    await issueGrant(requestId, actorName);
  } else {
    await db.consentRequest.update({ where: { id: requestId }, data: { status: "APPROVED_IN_PRINCIPLE" } });
  }
}
