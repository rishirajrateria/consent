import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para, FAINT, INK } from "@/lib/pdf";
import { eventLabel, fmtDateTime, shownEvent } from "@/lib/utils";
import type { Selection } from "@/lib/rules";

/** Public, downloadable consent certificate PDF (anyone with the link can verify). */
export async function GET(_req: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const grant = await db.grant.findUnique({
    where: { publicId },
    include: {
      request: {
        include: {
          consenter: true,
          requester: true,
          events: { orderBy: { createdAt: "asc" } },
        },
      },
      takedowns: true,
    },
  });
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Older certificates also carry `fee` and `agreementMode` in their signed
  // payload. They stay there (the signature covers them) but are not shown.
  const payload = grant.payload as {
    scope: { selections: Selection[]; assetTypes: string[]; conditions: string | null; intentCategory: string | null; thumbnailAllowed: boolean };
    fee?: unknown;
    agreementMode?: unknown;
    decidedBy: string;
    files: { kind: string; name: string; sha256: string; version: number }[];
  };
  const { request } = grant;
  const sideName = (side: string | null) =>
    side === "consenter"
      ? request.consenter.displayName
      : side === "requester"
        ? request.requester.displayName
        : side === "admin" || side === "system"
          ? "Consent"
          : null;
  const verifyUrl = `${process.env.APP_URL ?? ""}/v/${grant.publicId}`;
  const qrPng = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 120, color: { dark: "#111111", light: "#ffffff" } });

  const doc = newDoc(`Consent Certificate ${grant.certificateId}`);
  heading(doc, "Consent Certificate");
  sub(doc, `${grant.certificateId} · grant ${grant.publicId} · status: ${grant.status}${grant.revokedAt ? ` (revoked ${fmtDateTime(grant.revokedAt)}; valid for use published before this date)` : ""}`);

  // QR top-right
  doc.image(qrPng, doc.page.width - doc.page.margins.right - 90, 48, { width: 90 });
  doc.fillColor(FAINT).fontSize(6).text("Scan to verify", doc.page.width - doc.page.margins.right - 90, 140, { width: 90, align: "center" });
  doc.fillColor(INK);
  doc.text("", doc.page.margins.left, 150);

  sectionTitle(doc, "Parties");
  kv(doc, "Consent given by", `${request.consenter.legalName} ("${request.consenter.displayName}") — profile ${request.consenterId} — VERIFIED`);
  kv(doc, "Consent given to", `${request.requester.legalName} ("${request.requester.displayName}") — profile ${request.requesterId}`);

  sectionTitle(doc, "Approved scope");
  kv(doc, "Platforms & formats", payload.scope.selections.map((s) => `${s.platformName} → ${s.formatName}${s.durationSec ? ` (max ${s.durationSec}s)` : ""}`).join("; "));
  kv(doc, "Asset types", payload.scope.assetTypes.join(", "));
  kv(doc, "Thumbnail", payload.scope.thumbnailAllowed ? "Allowed" : "Not allowed");
  kv(doc, "Intent category", payload.scope.intentCategory ?? "—");
  kv(doc, "Conditions", payload.scope.conditions ?? "None");
  kv(
    doc,
    "Validity",
    grant.validityKind === "SINGLE_PUBLICATION"
      ? "Single publication"
      : grant.validityKind === "PERPETUAL"
        ? "Perpetual"
        : `${grant.validFrom?.toISOString()} → ${grant.validUntil?.toISOString()} (UTC)`
  );
  kv(doc, "Decision", payload.decidedBy);
  kv(doc, "Issued", `${grant.issuedAt.toISOString()} (UTC)`);

  sectionTitle(doc, "Approved files (SHA-256)");
  for (const f of payload.files) {
    para(doc, `${f.kind} v${f.version} — ${f.name}`, 8);
    para(doc, f.sha256, 7);
  }

  if (grant.takedowns.length > 0 || grant.revokedAt) {
    sectionTitle(doc, "Revocation & takedown history");
    if (grant.revokedAt) kv(doc, "Revoked", `${grant.revokedAt.toISOString()} — ${grant.revokeReason}`);
    for (const t of grant.takedowns) kv(doc, t.createdAt.toISOString(), `${t.status} — ${t.reason}`);
  }

  sectionTitle(doc, "Timeline (UTC)");
  for (const e of request.events.filter(shownEvent).slice(0, 30)) {
    const who = [e.actorName, sideName(e.actorSide)].filter(Boolean);
    const by = who.length === 2 && who[0] !== who[1] ? `${who[0]} (${who[1]})` : who[0];
    kv(doc, e.createdAt.toISOString(), `${eventLabel(e.type)}${by ? ` — ${by}` : ""}`);
  }

  sectionTitle(doc, "Digital signature");
  para(doc, "Ed25519 signature over the canonical JSON payload. Re-verify any time at the public verification page.", 8);
  para(doc, `Signature: ${grant.signature}`, 7);
  para(doc, `Public key:\n${grant.publicKey}`, 7);
  para(doc, `Verify at: ${verifyUrl}`, 8);

  const buf = await pdfToBuffer(doc);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${grant.certificateId}.pdf"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
