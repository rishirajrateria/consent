import { db } from "./db";
import { signPayload } from "./signing";
import { shortId } from "./utils";
import { notifyConsenterTeam, notifyRequesterTeam } from "./notify";
import { recalcConsenterScore, recalcRequesterScore } from "./score";

/**
 * The files a grant covers: every consenter asset, plus one version of the raw
 * content and of the thumbnail: the newest one that already existed when the
 * owner said yes. A version replaced before that (for example after the owner
 * asked for changes) or uploaded after it was never approved, so it is left
 * out. When no version existed yet (approved before the file was uploaded),
 * the newest one is used.
 */
export function boundFiles<F extends { kind: string; version: number; createdAt: Date }>(
  files: F[],
  approvedAt?: Date | null
): F[] {
  const newest = (list: F[]) => [...list].sort((a, b) => b.version - a.version)[0];
  const versioned = (["RAW_CONTENT", "THUMBNAIL"] as const).flatMap((kind) => {
    const all = files.filter((f) => f.kind === kind);
    const seen = approvedAt ? all.filter((f) => f.createdAt <= approvedAt) : all;
    const pick = newest(seen.length ? seen : all);
    return pick ? [pick] : [];
  });
  return [...files.filter((f) => f.kind === "ASSET"), ...versioned];
}

/**
 * When the owner said yes to this request. If the requester accepted the
 * owner's fee, the owner's yes was sending that fee, not the moment of accepting.
 */
export function ownerYesAt(request: {
  decidedAt: Date | null;
  offers: { status: string; bySide: string; createdAt: Date }[];
}): Date | null {
  const accepted = request.offers.find((o) => o.status === "ACCEPTED");
  return accepted?.bySide === "consenter" ? accepted.createdAt : request.decidedAt;
}

/**
 * Issues the grant + signed certificate for an approved request.
 * Preconditions: request approved with a raw content file uploaded (approval is
 * bound to exact file hashes). The canonical payload is signed with the
 * platform Ed25519 key; the public verification page re-verifies it.
 */
export async function issueGrant(requestId: string, issuedByName: string) {
  const request = await db.consentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      consenter: true,
      requester: true,
      files: true,
      offers: { orderBy: { version: "asc" } },
      agreement: true,
      grant: true,
    },
  });
  if (request.grant) return request.grant;

  const bound = boundFiles(request.files, ownerYesAt(request));
  const files = bound.map((f) => ({ kind: f.kind, name: f.name, sha256: f.sha256, version: f.version }));

  const publicId = shortId(10);
  const certificateId = `CERT-${new Date().getFullYear()}-${shortId(8).toUpperCase()}`;

  const payload = {
    certificateId,
    grantPublicId: publicId,
    requestNumber: request.number,
    consenter: {
      profileId: request.consenterId,
      legalName: request.consenter.legalName,
      displayName: request.consenter.displayName,
      verified: true,
    },
    requester: {
      profileId: request.requesterId,
      legalName: request.requester.legalName,
      displayName: request.requester.displayName,
    },
    scope: {
      selections: request.approvedSelections ?? request.selections,
      assetTypes: request.assetTypeNames,
      thumbnailAllowed: request.approvedThumbnail ?? request.thumbnailUsed,
      conditions: request.conditionsNote ?? null,
      intentCategory: request.intentCategoryName ?? null,
    },
    validity: {
      kind: request.validityKind,
      from: request.validFrom?.toISOString() ?? null,
      until: request.validUntil?.toISOString() ?? null,
    },
    files,
    fee: request.isPaid
      ? {
          amount: request.agreedAmount?.toString() ?? null,
          currency: request.agreedCurrency ?? null,
          note: "Fee agreed between parties; handled directly, not through Consent",
        }
      : { amount: null, currency: null, note: "Free" },
    agreementMode:
      request.agreementMode === "LEGALLY_BINDING"
        ? {
            mode: "Legally binding agreement",
            agreementId: request.agreement?.id ?? null,
            agreementSha256: request.agreement?.sha256 ?? null,
          }
        : { mode: "Consent-app record only", agreementId: null, agreementSha256: null },
    decidedBy: request.decidedByRuleName
      ? `Approved by standing rule "${request.decidedByRuleName}"`
      : `Approved by ${issuedByName}`,
    issuedAt: new Date().toISOString(),
  };

  const { signature, publicKey } = await signPayload(payload);

  const grant = await db.grant.create({
    data: {
      publicId,
      requestId,
      status: "ACTIVE",
      validityKind: request.validityKind,
      validFrom: request.validFrom,
      validUntil: request.validUntil,
      certificateId,
      payload,
      signature,
      publicKey,
      issuedByName,
    },
  });

  await db.$transaction([
    db.consentRequest.update({ where: { id: requestId }, data: { status: "APPROVED" } }),
    db.storedFile.updateMany({
      where: { id: { in: bound.map((f) => f.id) } },
      data: { approvedInGrant: true },
    }),
    db.requestEvent.create({
      data: {
        requestId,
        type: "grant_issued",
        actorName: issuedByName,
        actorSide: "system",
        detail: { certificateId, publicId },
      },
    }),
  ]);

  const base = process.env.APP_URL ?? "";
  await notifyRequesterTeam(request.requesterId, {
    title: `Consent granted — certificate ${certificateId}`,
    body: `${request.consenter.displayName} approved request #${request.number}. Remember: the verification link must appear in your published content. ${base}/v/${publicId}`,
    href: `/r-panel/requests/${requestId}`,
    critical: true,
  });
  await notifyConsenterTeam(request.consenterId, {
    title: `Grant issued for request #${request.number}`,
    body: `Certificate ${certificateId} for ${request.requester.displayName} is live.`,
    href: `/c-panel/requests/${requestId}`,
  });
  await recalcRequesterScore(request.requesterId, `Grant issued for request #${request.number}`);
  await recalcConsenterScore(request.consenterId, `Responded to request #${request.number}`);
  return grant;
}
