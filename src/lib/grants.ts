import type { RequestStatus } from "@prisma/client";
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

/** The certificate's "Decided by" line. */
function decidedByLine(
  r: { decidedByRuleId: string | null; decidedByRuleName: string | null; consenter: { displayName: string } },
  issuedByName: string,
): string {
  if (r.decidedByRuleName && !r.decidedByRuleId && r.decidedByRuleName.startsWith("Consent matrix")) {
    return `Approved automatically by ${r.consenter.displayName}'s terms`;
  }
  if (r.decidedByRuleName) return `Approved by standing rule "${r.decidedByRuleName}"`;
  return `Approved by ${issuedByName}`;
}

/** Where a certificate can be issued from: a yes waiting for the final file, or a yes without its certificate yet. */
export const GRANTABLE_STATUSES = ["APPROVED_IN_PRINCIPLE", "APPROVED"] as const satisfies readonly RequestStatus[];

/** Thrown when a request is no longer approved (closed, revoked or withdrawn meanwhile), so no certificate is issued. */
export class GrantError extends Error {}

/** A unique-constraint clash (Prisma P2002): here, another call issued this request's grant first. */
function alreadyExists(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/**
 * Issues the grant + signed certificate for an approved request.
 * Preconditions: request approved with a raw content file uploaded (approval is
 * bound to exact file hashes). The canonical payload is signed with the
 * platform Ed25519 key; the public verification page re-verifies it.
 *
 * The payload records who, what scope, which files and how long. It no longer
 * carries `fee` or `agreementMode`: certificates issued before may still have
 * them (their signatures cover them, so stored payloads are never changed),
 * and every reader treats them as optional and doesn't show them.
 *
 * `issuedBy` is who said yes; left out, it is the person who approved (or
 * the profile's name), so the asker's final-file upload can call it alone.
 *
 * Safe to call more than once and from racing callers (the sweep and the
 * asker's upload): an existing grant is returned as it is, and when two calls
 * issue at once the second returns the first's grant. Throws GrantError when
 * the request is not approved any more; then nothing changes.
 */
export async function issueGrant(requestId: string, issuedBy?: string | null) {
  const request = await db.consentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { consenter: true, requester: true, files: true, grant: true, decidedBy: { select: { name: true } } },
  });
  if (request.grant) return request.grant;
  if (!(GRANTABLE_STATUSES as readonly RequestStatus[]).includes(request.status)) {
    throw new GrantError(`Request #${request.number} is no longer approved, so no certificate was issued.`);
  }
  // Who said yes: the name given, else the person who approved, else the profile itself.
  const issuedByName = issuedBy?.trim() || request.decidedBy?.name || request.consenter.displayName;

  // The owner's yes is the moment the approval was recorded.
  const bound = boundFiles(request.files, request.decidedAt);
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
    decidedBy: decidedByLine(request, issuedByName),
    issuedAt: new Date().toISOString(),
  };

  const { signature, publicKey } = await signPayload(payload);

  let grant;
  try {
    grant = await db.$transaction(async (tx) => {
      // Only a request that is still approved gets its certificate; anything
      // that ended it since it was read above (closed by an admin, withdrawn)
      // leaves it as it is, with no grant.
      const moved = await tx.consentRequest.updateMany({
        where: { id: requestId, status: { in: [...GRANTABLE_STATUSES] } },
        data: { status: "APPROVED" },
      });
      if (moved.count === 0) {
        throw new GrantError(`Request #${request.number} is no longer approved, so no certificate was issued.`);
      }
      const created = await tx.grant.create({
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
      await tx.storedFile.updateMany({
        where: { id: { in: bound.map((f) => f.id) } },
        data: { approvedInGrant: true },
      });
      await tx.requestEvent.create({
        data: {
          requestId,
          type: "grant_issued",
          actorName: issuedByName,
          actorSide: "system",
          detail: { certificateId, publicId },
        },
      });
      return created;
    });
  } catch (e) {
    // Another call issued it first (one grant per request): that one stands,
    // and it already told both teams.
    if (alreadyExists(e)) return db.grant.findUniqueOrThrow({ where: { requestId } });
    throw e;
  }

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
