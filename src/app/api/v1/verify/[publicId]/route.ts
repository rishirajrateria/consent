import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyPayload } from "@/lib/signing";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}

/**
 * Public verification API (v1): lets platforms, newsrooms and tools check a
 * Consent certificate programmatically. The signature is re-verified live on
 * every call; the response never exposes private data.
 *
 *   GET /api/v1/verify/{grantPublicId | certificateId}
 */
export async function GET(_req: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const grant = await db.grant.findFirst({
    where: { OR: [{ publicId }, { certificateId: { equals: publicId, mode: "insensitive" } }] },
    include: {
      request: { include: { consenter: true, requester: { include: { consenter: { select: { slug: true } } } } } },
      takedowns: { select: { status: true, createdAt: true } },
    },
  });
  if (!grant) {
    return NextResponse.json({ found: false, error: "No certificate for that id" }, { status: 404, headers: CORS });
  }

  const signatureValid = verifyPayload(grant.payload, grant.signature, grant.publicKey);
  const effectiveStatus =
    grant.status === "ACTIVE" && grant.validUntil && grant.validUntil < new Date()
      ? "EXPIRED"
      : grant.status;
  // Older certificates also carry `fee` and `agreementMode` in their signed
  // payload. They stay in `payload` (the signature covers them) but are not
  // reported as fields.
  const payload = grant.payload as {
    scope: { selections: unknown; assetTypes: string[]; conditions: string | null; intentCategory: string | null };
    files: { kind: string; name: string; sha256: string; version: number }[];
    decidedBy: string;
  };
  const base = process.env.APP_URL ?? "";
  // Every profile has one public page, /c/<slug>; the asking half links to its profile's.
  const askerSlug = grant.request.requester.consenter?.slug;

  return NextResponse.json(
    {
      found: true,
      certificateId: grant.certificateId,
      grantId: grant.publicId,
      status: effectiveStatus,
      signatureValid,
      signatureAlgorithm: "Ed25519 over canonical JSON",
      // The profile that gave consent (key kept for API stability).
      consenter: {
        displayName: grant.request.consenter.displayName,
        verified: true,
        profileUrl: `${base}/c/${grant.request.consenter.slug}`,
      },
      // The profile consent was given to (key kept for API stability).
      requester: {
        displayName: grant.request.requester.displayName,
        profileUrl: askerSlug ? `${base}/c/${askerSlug}` : `${base}/r/${grant.request.requester.slug}`,
      },
      scope: payload.scope,
      approvedFileHashes: payload.files.map((f) => ({ kind: f.kind, sha256: f.sha256, version: f.version })),
      decidedBy: payload.decidedBy,
      validity: { kind: grant.validityKind, from: grant.validFrom, until: grant.validUntil },
      issuedAt: grant.issuedAt,
      revokedAt: grant.revokedAt,
      revokeReason: grant.revokeReason,
      takedowns: grant.takedowns,
      verificationPage: `${base}/v/${grant.publicId}`,
      publicKey: grant.publicKey,
      signature: grant.signature,
      payload: grant.payload,
    },
    { headers: CORS }
  );
}
