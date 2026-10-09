import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { signPayload } from "@/lib/signing";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para } from "@/lib/pdf";

/**
 * Consent History Dossier (for legal cases): all requests, file versions +
 * hashes, messages, offers, decisions, reports and the audit trail for one
 * request — as a signed PDF (?format=pdf, default) or signed JSON (?format=json).
 * Every export is logged.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const request = await db.consentRequest.findUnique({
    where: { id: requestId },
    include: {
      consenter: true,
      requester: true,
      files: true,
      messages: { include: { sender: true }, orderBy: { createdAt: "asc" } },
      offers: { include: { byUser: true }, orderBy: { version: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      grant: { include: { takedowns: true } },
      agreement: { include: { signatures: { include: { user: true } } } },
      reports: true,
    },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [cm, rm] = await Promise.all([
    db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: request.consenterId, userId: session.userId } },
    }),
    db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: request.requesterId, userId: session.userId } },
    }),
  ]);
  const isAdmin = !!session.user.adminRole;
  if (!cm && !rm && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (cm && cm.role !== "OWNER" && !cm.canExport)
    return NextResponse.json({ error: "Export permission required" }, { status: 403 });

  await db.exportLog.create({
    data: {
      kind: "dossier",
      scope: `request:${request.number}`,
      byUserId: session.userId,
      byName: session.user.name,
    },
  });

  const dossier = {
    generatedAt: new Date().toISOString(),
    request: {
      number: request.number,
      status: request.status,
      consenter: { legalName: request.consenter.legalName, profileId: request.consenterId },
      requester: { legalName: request.requester.legalName, profileId: request.requesterId },
      selections: request.selections,
      approvedSelections: request.approvedSelections,
      assetTypes: request.assetTypeNames,
      context: request.context,
      creativePlan: request.creativePlan,
      intent: request.intentCategoryName,
      validity: { kind: request.validityKind, from: request.validFrom, until: request.validUntil },
      conditions: request.conditionsNote,
      isPaid: request.isPaid,
      agreedAmount: request.agreedAmount?.toString() ?? null,
      agreedCurrency: request.agreedCurrency,
      denialReason: request.denialReason,
    },
    files: request.files.map((f) => ({ kind: f.kind, name: f.name, version: f.version, sha256: f.sha256, uploadedAt: f.createdAt })),
    messages: request.messages.map((m) => ({ at: m.createdAt, by: m.sender.name, side: m.senderSide, body: m.body })),
    offers: request.offers.map((o) => ({ version: o.version, by: o.byUser.name, side: o.bySide, amount: o.amount.toString(), currency: o.currency, status: o.status, at: o.createdAt })),
    events: request.events.map((e) => ({ at: e.createdAt, type: e.type, actor: e.actorName, side: e.actorSide, detail: e.detail })),
    grant: request.grant
      ? {
          certificateId: request.grant.certificateId,
          publicId: request.grant.publicId,
          status: request.grant.status,
          issuedAt: request.grant.issuedAt,
          revokedAt: request.grant.revokedAt,
          revokeReason: request.grant.revokeReason,
          takedowns: request.grant.takedowns,
        }
      : null,
    agreement: request.agreement
      ? {
          kind: request.agreement.kind,
          status: request.agreement.status,
          sha256: request.agreement.sha256,
          signatures: request.agreement.signatures.map((s) => ({ side: s.side, typedName: s.typedName, by: s.user.name, at: s.signedAt, otpVerified: s.otpVerified, ip: s.ip })),
        }
      : null,
    reports: request.reports.map((r) => ({ bySide: r.bySide, reason: r.reason, status: r.status, at: r.createdAt })),
  };

  const { signature, publicKey } = await signPayload(dossier);

  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json(
      { dossier, signature, publicKey, algorithm: "Ed25519 over canonical JSON" },
      { headers: { "Content-Disposition": `attachment; filename="dossier-request-${request.number}.json"` } }
    );
  }

  const doc = newDoc(`Consent History Dossier — Request #${request.number}`);
  heading(doc, "Consent History Dossier");
  sub(doc, `Request #${request.number} · ${request.consenter.displayName} ↔ ${request.requester.displayName} · generated ${new Date().toUTCString()}`);
  sectionTitle(doc, "Parties & request");
  kv(doc, "Consenter", request.consenter.legalName);
  kv(doc, "Requester", request.requester.legalName);
  kv(doc, "Status", request.status);
  kv(doc, "Asset types", request.assetTypeNames.join(", "));
  kv(doc, "Fee", request.isPaid ? `${request.agreedCurrency ?? ""} ${request.agreedAmount?.toString() ?? "under negotiation"} (settled directly between parties)` : "Free");
  sectionTitle(doc, "File versions & hashes");
  for (const f of dossier.files) para(doc, `${f.kind} v${f.version} — ${f.name}\nsha256:${f.sha256}`, 7);
  sectionTitle(doc, "Offers");
  for (const o of dossier.offers) kv(doc, `v${o.version} (${o.side})`, `${o.currency} ${o.amount} — ${o.status} — ${o.by}`);
  sectionTitle(doc, "Messages");
  for (const m of dossier.messages.slice(0, 50)) para(doc, `[${new Date(m.at).toISOString()}] ${m.by} (${m.side}): ${m.body}`, 7);
  sectionTitle(doc, "Timeline");
  for (const e of dossier.events) kv(doc, new Date(e.at).toISOString(), `${e.type}${e.actor ? ` — ${e.actor}` : ""}`);
  if (dossier.grant) {
    sectionTitle(doc, "Grant");
    kv(doc, "Certificate", dossier.grant.certificateId);
    kv(doc, "Status", dossier.grant.status);
    if (dossier.grant.revokedAt) kv(doc, "Revoked", `${dossier.grant.revokedAt.toISOString()} — ${dossier.grant.revokeReason}`);
  }
  sectionTitle(doc, "Platform signature (Ed25519 over the JSON dossier)");
  para(doc, `Signature: ${signature}`, 7);
  para(doc, `Public key:\n${publicKey}`, 7);
  para(doc, "The machine-readable signed dossier is available with ?format=json.", 8);

  const buf = await pdfToBuffer(doc);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="dossier-request-${request.number}.pdf"`,
    },
  });
}
