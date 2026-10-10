"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRequester } from "@/lib/auth";
import { startRequestCheckout } from "@/lib/payments";
import { canSend } from "@/lib/membership";
import { isSelfAsk } from "@/lib/profiles";
import { storeUpload } from "@/lib/storage";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { notifyConsenterTeam } from "@/lib/notify";
import { GrantError, issueGrant } from "@/lib/grants";
import { blockedCombinations, blockedPayNote } from "@/lib/precheck";
import type { Selection } from "@/lib/rules";
import type { FileKind, RequestStatus, ValidityKind } from "@prisma/client";
import { syncConsentPrice, YES_STATUSES } from "@/lib/escrow";
import { requestCapacity } from "@/lib/capacity";
import { fmtUtc, onRequestPaid, pausedNotice } from "@/lib/requests";

function fail(path: string, error: string): never {
  redirect(`${path}?error=${encodeURIComponent(error)}`);
}

const VIEW_ONLY = "You have view-only access.";

const CURRENT_FILE_LOCKED =
  "They already said yes to the current file. To use a different file, send a new request.";

/** Sent requests live under Requests → Sent. */
const SENT_LIST = "/c-panel/requests?tab=Sent";

/** Where a request lives: a draft is edited, a sent request is followed. */
function requestPath(request: { id: string; status: string }) {
  return request.status === "DRAFT" ? `/r-panel/requests/${request.id}/edit` : `/r-panel/requests/${request.id}`;
}

async function ownedRequest(id: string) {
  const { session, member, requester } = await requireRequester();
  const request = await db.consentRequest.findUnique({
    where: { id },
    include: { files: true, consenter: true },
  });
  if (!request || request.requesterId !== requester.id) redirect(SENT_LIST);
  // Viewer seats are read-only: every change (upload, withdraw, answer, draft
  // edits) is refused back on the request's own page.
  if (member.role === "VIEWER") fail(requestPath(request), VIEW_ONLY);
  return { session, requester, request };
}

// ── Draft creation & editing ──────────────────────────────────

/** Back to Find with an error, keeping the search. */
function backToFind(formData: FormData, error: string): never {
  const q = String(formData.get("q") ?? "").trim();
  redirect(`/find?${new URLSearchParams(q ? { q, error } : { error })}`);
}

/**
 * "Ask" on Find or a public profile: opens a draft request from the active
 * profile to the one asked (or the draft already started for them).
 */
export async function createDraftAction(formData: FormData) {
  const { session, member, requester } = await requireRequester();
  if (member.role === "VIEWER") backToFind(formData, "You have view-only access, so you can't send requests for this profile.");
  const settings = await getSettings();
  if (!canSend(requester, settings.membershipFeeOn))
    backToFind(
      formData,
      requester.status !== "APPROVED"
        ? "You can ask once your ID check is approved."
        : "Sending requests needs a membership. Get one in Payments & membership.",
    );
  const slug = String(formData.get("consenter") ?? "");
  const consenter = slug ? await db.consenterProfile.findUnique({ where: { slug } }) : null;
  if (!consenter || consenter.status !== "APPROVED") backToFind(formData, "We couldn't find that profile.");
  if (isSelfAsk(consenter.id, requester)) backToFind(formData, "This is your profile. You can't ask yourself.");

  const blocked = await db.listEntry.findUnique({
    where: {
      kind_consenterId_requesterId: {
        kind: "BLACKLIST",
        consenterId: consenter.id,
        requesterId: requester.id,
      },
    },
  });
  if (blocked) backToFind(formData, `${consenter.displayName} isn't taking requests from you.`);

  if (requester.score < settings.requesterMinScoreGate)
    backToFind(formData, `Your Consent Score is too low to send requests right now (the minimum is ${settings.requesterMinScoreGate}).`);

  const existingDraft = await db.consentRequest.findFirst({
    where: { requesterId: requester.id, consenterId: consenter.id, status: "DRAFT" },
  });
  if (existingDraft) redirect(`/r-panel/requests/${existingDraft.id}/edit`);

  const request = await db.consentRequest.create({
    data: {
      requesterId: requester.id,
      consenterId: consenter.id,
      status: "DRAFT",
      selections: [],
      assetTypeIds: [],
      assetTypeNames: [],
      context: "",
      creativePlan: "",
      validityKind: "SINGLE_PUBLICATION",
    },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "request_draft_created",
    module: "requests",
    targetId: request.id,
  });
  redirect(`/r-panel/requests/${request.id}/edit`);
}

export async function saveScopeAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { requester, request } = await ownedRequest(id);
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);
  const path = `/r-panel/requests/${id}/edit`;

  const formatIds = formData.getAll("formatIds").map(String).filter(Boolean);
  if (formatIds.length === 0) fail(path, "Select at least one platform format");
  const formats = await db.format.findMany({ where: { id: { in: formatIds } }, include: { platform: true } });
  const selections: Selection[] = [];
  for (const f of formats) {
    let durationSec: number | null = null;
    if (f.isTimed) {
      durationSec = parseInt(String(formData.get(`duration_${f.id}`) ?? ""), 10);
      if (!durationSec || durationSec < 1)
        fail(path, `Enter the duration in seconds for ${f.platform.name} → ${f.name}`);
    }
    selections.push({
      platformId: f.platformId,
      platformName: f.platform.name,
      formatId: f.id,
      formatName: f.name,
      durationSec,
    });
  }

  const assetTypeIds = formData.getAll("assetTypeIds").map(String).filter(Boolean);
  if (assetTypeIds.length === 0) fail(path, "Select at least one asset type");
  const assetTypes = await db.assetType.findMany({ where: { id: { in: assetTypeIds } } });

  await db.consentRequest.update({
    where: { id },
    data: {
      selections: selections as unknown as object,
      assetTypeIds,
      assetTypeNames: assetTypes.map((a) => a.name),
      thumbnailUsed: formData.get("thumbnailUsed") === "on",
    },
  });
  // Stay on the scope section when the owner never allows part of it, so the
  // note on what to remove is the first thing seen.
  const blocked = await blockedCombinations({
    consenterId: request.consenterId,
    requester,
    selections,
    assetTypeIds,
  });
  redirect(`${path}?saved=scope#${blocked.length ? "scope" : "uploads"}`);
}

export async function saveDetailsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { request } = await ownedRequest(id);
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);
  const path = `/r-panel/requests/${id}/edit`;
  const settings = await getSettings();

  const context = String(formData.get("context") ?? "").trim();
  const creativePlan = String(formData.get("creativePlan") ?? "").trim();
  if (context.length < 20)
    fail(path, `Describe the content and where ${request.consenter.displayName} appears (at least 20 characters)`);
  if (creativePlan.length < settings.minCreativePlanChars)
    fail(path, `Explain your creative plan and intent in at least ${settings.minCreativePlanChars} characters`);

  const intentCategoryId = String(formData.get("intentCategoryId") ?? "");
  const intent = await db.intentCategory.findUnique({ where: { id: intentCategoryId } });
  if (!intent) fail(path, "Pick an intent category");

  const validityKind = String(formData.get("validityKind")) as ValidityKind;
  let validFrom: Date | null = null;
  let validUntil: Date | null = null;
  if (validityKind === "DATE_RANGE") {
    validFrom = new Date(String(formData.get("validFrom")));
    validUntil = new Date(String(formData.get("validUntil")));
    if (isNaN(validFrom.getTime()) || isNaN(validUntil.getTime()) || validUntil <= validFrom)
      fail(path, "Enter a valid date range");
  }
  const plannedRaw = String(formData.get("plannedPublishAt") ?? "");
  const plannedPublishAt = plannedRaw ? new Date(plannedRaw) : null;

  await db.consentRequest.update({
    where: { id },
    data: {
      context,
      creativePlan,
      intentCategoryId,
      intentCategoryName: intent.name,
      validityKind,
      validFrom,
      validUntil,
      plannedPublishAt,
    },
  });
  redirect(`${path}?saved=details#review`);
}

/**
 * Issues the certificate for a yes whose final content file is in, in the
 * name of whoever said yes (read now, so a yes given a moment ago counts),
 * then opens the request with `?certified=<note>`.
 */
async function certify(id: string, path: string, note: "upload" | "ready" | "existing"): Promise<never> {
  const now = await db.consentRequest.findUnique({
    where: { id },
    select: { decidedById: true, decidedByRuleName: true, consenter: { select: { displayName: true } } },
  });
  const decider = now?.decidedById
    ? await db.user.findUnique({ where: { id: now.decidedById }, select: { name: true } })
    : null;
  try {
    await issueGrant(id, decider?.name ?? now?.decidedByRuleName ?? now?.consenter.displayName);
  } catch (e) {
    if (e instanceof GrantError) fail(path, e.message);
    throw e;
  }
  redirect(`${path}?certified=${note}`);
}

/**
 * A yes whose final content file is already in (it came in while the yes was
 * being given): the certificate is owed, so this issues it from that file.
 */
export async function issueCertificateAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { request } = await ownedRequest(id);
  const path = `/r-panel/requests/${id}`;
  if (request.status === "APPROVED") redirect(path);
  if (request.status !== "APPROVED_IN_PRINCIPLE") fail(path, "This request isn't approved, so there's no certificate to get.");
  if (!request.files.some((f) => f.kind === "RAW_CONTENT")) fail(path, "Upload the final content file first.");
  await certify(id, path, "ready");
}

export async function uploadRequestFileAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request } = await ownedRequest(id);
  const path = requestPath(request);
  const kind = String(formData.get("kind")) as FileKind;
  if (!["ASSET", "RAW_CONTENT", "THUMBNAIL"].includes(kind)) redirect(path);

  const replacesId =
    kind === "RAW_CONTENT" || kind === "THUMBNAIL"
      ? request.files.filter((f) => f.kind === kind).sort((a, b) => b.version - a.version)[0]?.id
      : undefined;

  // Once the owner has said yes, the files they said yes to are fixed: the
  // certificate binds to those exact files, so a swapped or added file would
  // never be covered (a first thumbnail after the yes would otherwise be bound
  // without the owner ever seeing it). Approved in principle still takes the
  // first final content file, which issues the certificate. A revision while
  // the owner's question is open is sent with the answer (answerAskAction).
  const owner = request.consenter.displayName;
  // Approved in principle with a final file already in (it came in as they
  // said yes): the certificate is owed for that file, never a dead end.
  if (kind === "RAW_CONTENT" && replacesId && request.status === "APPROVED_IN_PRINCIPLE")
    await certify(id, path, "existing");
  if (replacesId && YES_STATUSES.includes(request.status))
    fail(path, CURRENT_FILE_LOCKED);
  if ((kind === "ASSET" || kind === "THUMBNAIL") && YES_STATUSES.includes(request.status))
    fail(path, replacesId ? CURRENT_FILE_LOCKED : `${owner} already said yes to these files. To add another, send a new request.`);
  // A certificate is bound to the approved files: a new version never moves it.
  if (["APPROVED", "DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"].includes(request.status))
    fail(path, "This request has ended. Send a new request for a new file.");
  if (request.status === "CHANGES_REQUESTED")
    fail(path, `Add the new file to your answer, so ${owner} gets both together.`);

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) fail(path, "Choose a file to upload");
  const settings = await getSettings();

  try {
    await storeUpload({
      file,
      kind,
      uploadedById: session.userId,
      requestId: id,
      replacesId,
      maxMb: settings.maxUploadMb,
    });
  } catch (e) {
    fail(path, e instanceof Error ? e.message : "Upload failed");
  }

  await db.requestEvent.create({
    data: {
      requestId: id,
      type: "file_uploaded",
      actorName: session.user.name,
      actorSide: "requester",
      detail: { kind, name: file.name, version: replacesId ? "new version" : 1 },
    },
  });

  // Approved in principle + the final file → the certificate is issued now.
  // The status is read again: a yes given while the file was uploading read
  // the files before this one was in, so it left the certificate to this upload.
  if (kind === "RAW_CONTENT") {
    const now = await db.consentRequest.findUnique({ where: { id }, select: { status: true } });
    if (now?.status === "APPROVED_IN_PRINCIPLE") await certify(id, path, "upload");
  }
  redirect(`${path}?saved=upload#uploads`);
}

export async function deleteDraftFileAction(formData: FormData) {
  const id = String(formData.get("id"));
  const fileId = String(formData.get("fileId"));
  const { request } = await ownedRequest(id);
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);
  await db.storedFile.deleteMany({ where: { id: fileId, requestId: id } });
  redirect(`/r-panel/requests/${id}/edit#uploads`);
}

export async function submitRequestAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { requester, request } = await ownedRequest(id);
  const path = `/r-panel/requests/${id}/edit`;
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);
  const owner = request.consenter.displayName;
  const settings = await getSettings();
  if (!canSend(requester, settings.membershipFeeOn))
    fail(
      path,
      requester.status !== "APPROVED"
        ? "You can send requests once your ID check is approved."
        : "Sending requests needs a membership. Get one in Payments & membership.",
    );
  if (isSelfAsk(request.consenterId, requester)) fail(path, "This is your profile. You can't ask yourself.");
  if (request.consenter.status !== "APPROVED") fail(path, `${owner} isn't taking requests right now.`);

  const selections = request.selections as Selection[];
  if (!selections?.length) fail(path, "Choose platforms and formats first");
  if (!request.assetTypeIds.length) fail(path, "Choose what of them you use first");
  if (!request.context || !request.creativePlan || !request.intentCategoryId)
    fail(path, "Complete the context, creative plan and intent section");

  const onlyName =
    request.assetTypeNames.length === 1 && request.assetTypeNames[0].toLowerCase() === "name";
  const hasAssets = request.files.some((f) => f.kind === "ASSET");
  if (!onlyName && !hasAssets)
    fail(path, "Upload the exact images or clips you will use. Only a request for their name alone needs none.");
  if (request.thumbnailUsed && !request.files.some((f) => f.kind === "THUMBNAIL"))
    fail(path, `You said the thumbnail uses ${owner}. Upload it too.`);
  // Never take fees that don't fully come back (the platform fee, and 20% of
  // the consent request fee) for a request the owner's public terms would
  // decline the moment it is sent.
  const blocked = await blockedCombinations({
    consenterId: request.consenterId,
    requester,
    selections,
    assetTypeIds: request.assetTypeIds,
  });
  if (blocked.length) fail(path, blockedPayNote(owner));
  // The owner's request limits: while new requests are paused, nothing is
  // sent or charged. The draft is kept so it can be sent once they open
  // again; Step 4 says why and when, in the viewer's own time zone.
  const capacity = await requestCapacity(request.consenterId);
  if (capacity.paused) redirect(`${path}?paused=1#review`);
  if (formData.get("acceptTerms") !== "on")
    fail(path, "Accept the terms, including the consent-link rule, to send it");

  const checkout = await startRequestCheckout({
    requesterId: requester.id,
    requestId: id,
    returnTo: `/r-panel/requests/${id}?submitted=1`,
  });
  // Free to ask: nothing to pay, so it is sent straight away.
  if (checkout.free) {
    await onRequestPaid(id);
    redirect(`/r-panel/requests/${id}?submitted=1`);
  }
  redirect(checkout.checkoutUrl);
}

/**
 * Discards a draft that was never sent: it is deleted with its files, so the
 * owner never sees it. Unpaid checkout lines go with it.
 */
export async function discardDraftAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, request } = await ownedRequest(id);
  if (request.status !== "DRAFT") redirect(`/r-panel/requests/${id}`);
  const [paid, reports] = await Promise.all([
    db.payment.count({ where: { requestId: id, status: { not: "PENDING" } } }),
    db.report.count({ where: { requestId: id } }),
  ]);
  if (paid || reports) {
    // Records point at it, so it can't be deleted; close it instead. It was
    // never sent, so the person asked never sees it.
    await db.consentRequest.update({ where: { id }, data: { status: "WITHDRAWN" } });
    await syncConsentPrice(id);
  } else {
    await db.$transaction([
      db.storedFile.deleteMany({ where: { requestId: id } }),
      db.payment.deleteMany({ where: { requestId: id, status: "PENDING" } }),
      db.consentRequest.delete({ where: { id } }),
    ]);
  }
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "request_draft_discarded",
    module: "requests",
    targetId: id,
  });
  redirect(`${SENT_LIST}&discarded=1`);
}

/** Before any answer: the asker can still take the request back. */
const WITHDRAWABLE: RequestStatus[] = ["SUBMITTED", "PENDING", "CHANGES_REQUESTED"];

export async function withdrawRequestAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, requester, request } = await ownedRequest(id);
  const path = `/r-panel/requests/${id}`;
  // An unsent draft is discarded (discardDraftAction), never withdrawn.
  if (!WITHDRAWABLE.includes(request.status)) fail(path, "This request can no longer be withdrawn.");
  // Only while it is still open, even if the owner answers at the same moment.
  const withdrawn = await db.$transaction(async (tx) => {
    const moved = await tx.consentRequest.updateMany({
      where: { id, status: { in: WITHDRAWABLE } },
      data: { status: "WITHDRAWN" },
    });
    if (moved.count === 0) return false;
    await tx.requestEvent.create({
      data: { requestId: id, type: "withdrawn", actorName: session.user.name, actorSide: "requester" },
    });
    return true;
  });
  if (!withdrawn) fail(path, `${request.consenter.displayName} already answered, so it can't be withdrawn.`);
  // Withdrawn before a yes: 80% of a held consent request fee is refunded.
  await syncConsentPrice(id);
  await notifyConsenterTeam(request.consenterId, {
    title: `${requester.displayName} withdrew request #${request.number}`,
    body: "Nothing more to do. It's no longer waiting for your answer.",
    href: `/c-panel/requests/${id}`,
  });
  redirect(path);
}

const ANSWER_MAX = 4000;

/** Same line breaks and no outer whitespace, so an untouched plan never counts as changed. */
function normText(s: string) {
  return s.replace(/\r\n?/g, "\n").trim();
}

/** A request the owner has already decided on (said yes or no). */
const DECIDED: RequestStatus[] = [...YES_STATUSES, "DENIED"];

/** Why an answer wasn't sent: a teammate answered first, or the question is gone. */
async function notSentReason(id: string, owner: string) {
  const [now, latest] = await Promise.all([
    db.consentRequest.findUnique({ where: { id }, select: { status: true } }),
    db.requestEvent.findFirst({
      where: { requestId: id, type: { in: ["changes_requested", "ask_answered"] } },
      orderBy: { createdAt: "desc" },
      select: { type: true },
    }),
  ]);
  if (latest?.type === "ask_answered") return "Someone on your team already answered.";
  if (now && DECIDED.includes(now.status)) return `${owner} already decided, so your answer wasn't sent.`;
  return "This question was already answered or closed. Nothing was sent.";
}

/**
 * The asker answers the owner's Ask in writing, and may update their plan and
 * upload a new final file with it. Sending the answer puts the request back
 * with the owner.
 */
export async function answerAskAction(formData: FormData) {
  const id = String(formData.get("id"));
  const { session, requester, request } = await ownedRequest(id);
  const path = `/r-panel/requests/${id}`;
  const owner = request.consenter.displayName;
  if (request.status !== "CHANGES_REQUESTED") fail(path, `There's no question from ${owner} to answer right now.`);

  // CRLF line breaks would count twice against the length the form allows.
  const answer = normText(String(formData.get("answer") ?? ""));
  if (!answer) fail(path, "Write your answer");
  if (answer.length > ANSWER_MAX) fail(path, `Keep your answer under ${ANSWER_MAX.toLocaleString("en-US")} characters`);

  // The plan field starts with the current plan: only a changed one is saved.
  const settings = await getSettings();
  // Browsers send textarea line breaks as CRLF: compare like with like.
  const plan = normText(String(formData.get("creativePlan") ?? ""));
  const planChanged = plan !== "" && plan !== normText(request.creativePlan);
  if (planChanged && plan.length < settings.minCreativePlanChars)
    fail(path, `Write your plan in at least ${settings.minCreativePlanChars} characters, or leave it as it was`);

  // An optional new version of the final file, stored before anything changes
  // so a failed upload leaves the question open.
  const file = formData.get("file");
  const upload = file instanceof File && file.size > 0 ? file : null;
  let storedId: string | null = null;
  if (upload) {
    const replacesId = request.files
      .filter((f) => f.kind === "RAW_CONTENT")
      .sort((a, b) => b.version - a.version)[0]?.id;
    try {
      const stored = await storeUpload({
        file: upload,
        kind: "RAW_CONTENT",
        uploadedById: session.userId,
        requestId: id,
        replacesId,
        maxMb: settings.maxUploadMb,
      });
      storedId = stored.id;
    } catch (e) {
      fail(path, e instanceof Error ? e.message : "Upload failed");
    }
  }

  // Whether the owner's request limits already held new requests back. The
  // answer puts this request back in their waiting count, which can pause them.
  const before = await requestCapacity(request.consenterId).catch(() => null);

  // Only one answer per question, even if two teammates send at once.
  const sent = await db.$transaction(async (tx) => {
    const moved = await tx.consentRequest.updateMany({
      where: { id, status: "CHANGES_REQUESTED" },
      data: { status: "PENDING", ...(planChanged ? { creativePlan: plan } : {}) },
    });
    if (moved.count === 0) return false;
    if (upload) {
      await tx.requestEvent.create({
        data: {
          requestId: id,
          type: "file_uploaded",
          actorName: session.user.name,
          actorSide: "requester",
          detail: { kind: "RAW_CONTENT", name: upload.name, version: request.files.some((f) => f.kind === "RAW_CONTENT") ? "new version" : 1 },
        },
      });
    }
    // A changed plan is part of the answer (detail.planUpdated), not a separate line.
    await tx.requestEvent.create({
      data: {
        requestId: id,
        type: "ask_answered",
        actorName: session.user.name,
        actorSide: "requester",
        detail: { answer, ...(planChanged ? { planUpdated: true } : {}), ...(upload ? { fileName: upload.name } : {}) },
      },
    });
    return true;
  });
  if (!sent) {
    // The file went with an answer that was never sent: drop it again.
    if (storedId) await db.storedFile.deleteMany({ where: { id: storedId, requestId: id } });
    fail(path, await notSentReason(id, owner));
  }
  await syncConsentPrice(id);

  const also = [planChanged && "updated their plan", upload && "uploaded a new final file"].filter(Boolean);
  await notifyConsenterTeam(request.consenterId, {
    title: `${requester.displayName} answered you on request #${request.number}`,
    body: `"${answer.length > 280 ? `${answer.slice(0, 277)}…` : answer}"${
      also.length ? ` They also ${also.join(" and ")}.` : ""
    } It's back with you to decide.`,
    href: `/c-panel/requests/${id}`,
  });
  // This answer reached one of the owner's limits: tell their team once, as it happens.
  if (before && !before.paused) {
    const after = await requestCapacity(request.consenterId).catch(() => null);
    if (after?.paused) {
      await notifyConsenterTeam(request.consenterId, { ...pausedNotice(after, fmtUtc), href: "/c-panel" });
    }
  }
  redirect(`${path}?answered=1`);
}
