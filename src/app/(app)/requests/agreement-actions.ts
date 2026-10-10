"use server";

import { redirect } from "next/navigation";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { issueOtp } from "@/lib/auth";
import { getESignProvider, canActOnAgreement, agreementTemplateFor } from "@/lib/esign";
import { email } from "@/lib/providers";
import { storeUpload } from "@/lib/storage";
import { issueGrant, boundFiles, ownerYesAt } from "@/lib/grants";
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

/**
 * Resolves the acting side and refuses read-only seats: requester viewers, and
 * consenter team members who can't approve requests.
 */
async function agreementActor(id: string) {
  const resolved = await resolveSide(id);
  const path = panelPath(resolved.side, id);
  const member = resolved.side === "consenter" ? resolved.consenterMember : resolved.requesterMember;
  if (!canActOnAgreement(resolved.side, member))
    fail(path, resolved.side === "requester" ? "Viewers have read-only access" : "You need the approve permission to act on the agreement");
  return { ...resolved, path };
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
  const { session, request, side, path } = await agreementActor(id);
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
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (request.status !== "LEGAL_AGREEMENT_PENDING" || !agreement || agreement.status !== "PROPOSED") fail(path, "No open proposal");
  if (agreement.proposedBySide === side) fail(path, "The other side must respond to your proposal");

  if (accept) {
    await db.agreement.update({ where: { requestId: id }, data: { status: "DRAFTING" } });
    await db.requestEvent.create({
      data: { requestId: id, type: "legal_agreement_accepted", actorName: session.user.name, actorSide: side },
    });
    await notifyOther(side, request, `Agreement proposal accepted on request #${request.number}`, "Choose how to create the agreement: platform-generated or upload your own signed contract.");
  } else {
    // The request stays here: the side that proposed decides what happens next
    // (continueWithAppRecordAction, or close the request).
    await db.agreement.update({ where: { requestId: id }, data: { status: "DECLINED" } });
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
  decidedAt: Date | null;
  offers: { status: string; bySide: string; createdAt: Date }[];
  files: { kind: string; sha256: string; name: string; version: number; createdAt: Date }[];
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
  // The caller refuses a paid request without an agreed fee, so this never prints 0.
  const fee = request.isPaid
    ? `${fmtMoney(String(request.agreedAmount), request.agreedCurrency ?? "USD")} agreed between the parties, settled directly (not through Consent)`
    : "No usage fee";
  // Exactly the files the certificate binds: the consenter's assets plus the one
  // approved version of the content and thumbnail, never every uploaded version.
  const bound = boundFiles(request.files, ownerYesAt(request));
  const lines = bound.map((f) =>
    f.kind === "ASSET"
      ? `${f.kind}: ${f.name} — sha256:${f.sha256}`
      : `${f.kind}: ${f.name} (version ${f.version}) — sha256:${f.sha256}`
  );
  if (lines.length && !bound.some((f) => f.kind === "RAW_CONTENT")) lines.push("RAW_CONTENT: to be bound on final file upload");
  const hashes = lines.join("\n") || "To be bound on final file upload";
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
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (request.status !== "LEGAL_AGREEMENT_PENDING" || !agreement || agreement.status !== "DRAFTING")
    fail(path, "Agreement is not in drafting state");

  if (kind === "PLATFORM_GENERATED") {
    const full = await db.consentRequest.findUniqueOrThrow({
      where: { id },
      include: { consenter: true, requester: true, files: true, offers: { orderBy: { version: "asc" } } },
    });
    if (full.isPaid && full.agreedAmount == null) fail(path, "No agreed fee on this paid request yet. Agree the fee first.");
    // Country-specific first, GLOBAL fallback; the panel lists clauses from the same template.
    const template = await agreementTemplateFor(full.requester.country);
    if (!template) fail(path, "No agreement template is configured — contact support");
    const optional = (template.optionalClauses as { id: string; title: string; body: string }[]) ?? [];
    const chosen = formData.getAll("clauses").map(String);
    // Never drop a ticked clause without a word (e.g. the template changed meanwhile).
    if (chosen.some((c) => !optional.some((o) => o.id === c)))
      fail(path, "The optional clauses have changed. Tick the ones you want again.");
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
  const { session, path } = await agreementActor(id);
  const code = await issueOtp(session.userId, "SIGNATURE", session.user.email);
  const { renderMessage } = await import("@/lib/templates");
  const msg = await renderMessage("signature_otp_email", { subject: "Your Consent e-signature code", body: "Code to sign the agreement: {{code}}. It expires in 10 minutes." }, { code });
  await email.send(session.user.email, msg.subject!, msg.body);
  redirect(`${path}?otp=sent`);
}

export async function signAgreementAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({
    where: { requestId: id },
    include: { signatures: true },
  });
  if (request.status !== "LEGAL_AGREEMENT_PENDING" || !agreement || agreement.status !== "AWAITING_SIGNATURES")
    fail(path, "Agreement is not awaiting signatures");
  if (agreement.signatures.some((s) => s.side === side)) fail(path, "Your side has already signed");
  // The signature binds the exact text the signer read, never a newer draft.
  if (String(formData.get("sha256") ?? "") !== agreement.sha256)
    fail(path, "The agreement text has changed. Read the new version, then sign.");

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
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (request.status !== "LEGAL_AGREEMENT_PENDING" || !agreement || agreement.status !== "UPLOAD_PENDING_CONFIRMATION")
    fail(path, "Not awaiting an upload");
  // The uploader may replace their own file; a file from the other side is
  // confirmed or rejected, not overwritten.
  if (agreement.uploadedFileId && agreement.uploadConfirmedBySide !== side)
    fail(path, "The other side already uploaded a file. Check it first.");
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
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (
    request.status !== "LEGAL_AGREEMENT_PENDING" ||
    !agreement ||
    agreement.status !== "UPLOAD_PENDING_CONFIRMATION" ||
    !agreement.uploadedFileId
  )
    fail(path, "No uploaded agreement to confirm");
  if (agreement.uploadConfirmedBySide === side) fail(path, "The other side must confirm the upload");
  // Confirm only the file that was checked, not one swapped in meanwhile.
  if (String(formData.get("fileId") ?? "") !== agreement.uploadedFileId)
    fail(path, "The file was replaced. Open the new one and check it.");
  await db.requestEvent.create({
    data: { requestId: id, type: "agreement_upload_confirmed", actorName: session.user.name, actorSide: side },
  });
  await completeAgreement(id, session.user.name);
  redirect(path);
}

/**
 * Either side that hasn't signed yet sends the generated agreement back to
 * drafting with a reason. Any signature already on it is voided.
 */
export async function requestRedraftAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id }, include: { signatures: true } });
  if (request.status !== "LEGAL_AGREEMENT_PENDING" || !agreement || agreement.status !== "AWAITING_SIGNATURES")
    fail(path, "Agreement is not awaiting signatures");
  if (agreement.signatures.some((s) => s.side === side)) fail(path, "Your side has already signed this draft");
  if (String(formData.get("sha256") ?? "") !== agreement.sha256)
    fail(path, "The agreement text has changed. Read the new version first.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) fail(path, "Say what should change");

  await db.$transaction([
    db.agreement.update({ where: { requestId: id }, data: { status: "DRAFTING", kind: null } }),
    db.agreementSignature.deleteMany({ where: { agreementId: agreement.id } }),
    db.requestEvent.create({
      data: { requestId: id, type: "agreement_redraft_requested", actorName: session.user.name, actorSide: side, detail: { reason } },
    }),
  ]);
  await notifyOther(side, request, `New agreement draft asked for on request #${request.number}`, `“${reason.slice(0, 140)}” Any signature on the old draft was removed. Choose how to write the agreement again.`);
  redirect(path);
}

/** The checking side says the uploaded file isn't the right, fully signed document. */
export async function rejectUploadedAgreementAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (
    request.status !== "LEGAL_AGREEMENT_PENDING" ||
    !agreement ||
    agreement.status !== "UPLOAD_PENDING_CONFIRMATION" ||
    !agreement.uploadedFileId
  )
    fail(path, "No uploaded agreement to check");
  if (agreement.uploadConfirmedBySide === side) fail(path, "The other side checks the file you uploaded");
  if (String(formData.get("fileId") ?? "") !== agreement.uploadedFileId)
    fail(path, "The file was replaced. Open the new one and check it.");
  // Back to the upload step for both sides; the stored file stays in the history.
  await db.agreement.update({
    where: { requestId: id },
    data: { uploadedFileId: null, uploadConfirmedBySide: null, sha256: null },
  });
  await db.requestEvent.create({
    data: { requestId: id, type: "agreement_upload_rejected", actorName: session.user.name, actorSide: side },
  });
  await notifyOther(side, request, `Uploaded agreement not accepted on request #${request.number}`, "The other side says it isn't the right, fully signed document. Upload the correct file. To talk it through, schedule a meeting on the request.");
  redirect(path);
}

/**
 * After the other side declines the agreement, the side that proposed it
 * continues with the Consent-app record (or closes the request instead).
 */
export async function continueWithAppRecordAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request, side, path } = await agreementActor(id);
  const agreement = await db.agreement.findUnique({ where: { requestId: id } });
  if (request.status !== "LEGAL_AGREEMENT_PENDING" || !agreement || agreement.status !== "DECLINED")
    fail(path, "Nothing to continue");
  if (agreement.proposedBySide !== side) fail(path, "The side that proposed the agreement decides what happens next");

  await db.consentRequest.update({ where: { id }, data: { agreementMode: "APP_RECORD" } });
  await db.requestEvent.create({
    data: {
      requestId: id,
      type: "agreement_mode_chosen",
      actorName: session.user.name,
      actorSide: side,
      detail: { mode: "Consent-app record only" },
    },
  });
  const hasRaw = (await db.storedFile.count({ where: { requestId: id, kind: "RAW_CONTENT" } })) > 0;
  if (hasRaw) {
    // The certificate names whoever approved the request.
    const decider =
      side === "consenter"
        ? session.user.name
        : request.decidedById
          ? (await db.user.findUnique({ where: { id: request.decidedById } }))?.name
          : undefined;
    await issueGrant(id, decider ?? request.decidedByRuleName ?? "Consenter");
  } else {
    await db.consentRequest.update({ where: { id }, data: { status: "APPROVED_IN_PRINCIPLE" } });
    await notifyOther(side, request, `Request #${request.number} continues with the Consent-app record`, "No legally binding agreement. The certificate is issued once the final content file is uploaded.");
  }
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
