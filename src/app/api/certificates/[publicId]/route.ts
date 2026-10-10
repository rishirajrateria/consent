import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para, FAINT, INK } from "@/lib/pdf";
import { fmtDateTime } from "@/lib/utils";
import type { Selection } from "@/lib/rules";

/** Public, downloadable consent certificate PDF (anyone with the link can verify). */
export async function GET(_req: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const grant = await db.grant.findUnique({
    where: { publicId },
    include: {
      request: { include: { consenter: true, requester: true, events: { orderBy: { createdAt: "asc" } } } },
      takedowns: true,
    },
  });
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = grant.payload as {
    scope: { selections: Selection[]; assetTypes: string[]; conditions: string | null; intentCategory: string | null; thumbnailAllowed: boolean };
    fee: { note: string; amount: string | null; currency: string | null };
    agreementMode: { mode: string; agreementId: string | null; agreementSha256: string | null };
    decidedBy: string;
    files: { kind: string; name: string; sha256: string; version: number }[];
  };
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
  kv(doc, "Consenter", `${grant.request.consenter.legalName} ("${grant.request.consenter.displayName}") — profile ${grant.request.consenterId} — VERIFIED`);
  kv(doc, "Requester", `${grant.request.requester.legalName} ("${grant.request.requester.displayName}") — profile ${grant.request.requesterId}`);

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
  kv(doc, "Usage fee", payload.fee.amount ? `${payload.fee.currency} ${payload.fee.amount} — ${payload.fee.note}` : payload.fee.note);
  kv(doc, "Agreement mode", payload.agreementMode.mode + (payload.agreementMode.agreementSha256 ? ` — agreement sha256 ${payload.agreementMode.agreementSha256}` : ""));
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
  for (const e of grant.request.events.slice(0, 30)) {
    kv(doc, e.createdAt.toISOString(), `${e.type}${e.actorName ? ` — ${e.actorName} (${e.actorSide})` : e.actorSide ? ` — ${e.actorSide}` : ""}`);
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
