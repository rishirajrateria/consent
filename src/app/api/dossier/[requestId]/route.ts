import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { signPayload } from "@/lib/signing";
import { newDoc, pdfToBuffer, heading, sub, sectionTitle, kv, para } from "@/lib/pdf";
import { eventLabel, fmtMoney, shownEvent, statusLabel } from "@/lib/utils";

/**
 * Consent History Dossier (for legal cases): the request, file versions +
 * hashes, the consent request fee and where it went, decisions, reports, any
 * older messages and the timeline for one request — as a signed PDF
 * (?format=pdf, default) or signed JSON (?format=json). Every export is logged.
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
      events: { orderBy: { createdAt: "asc" } },
      grant: { include: { takedowns: true } },
      reports: true,
      earning: true,
      payments: { where: { purpose: "CONSENT_PRICE", status: { in: ["PAID", "REFUNDED"] } }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // One rule for both profiles on the request: a seat can export when it is
  // the OWNER or has the export permission. The asking profile's seat is read
  // through its pair (the same roles and flags as the profile asked); an old
  // sending-only profile has just a role, so only its OWNER can export.
  const userId = session.userId;
  const [receiving, askingPaired, askingOnly] = await Promise.all([
    db.consenterMember.findUnique({
      where: { consenterId_userId: { consenterId: request.consenterId, userId } },
    }),
    request.requester.consenterId
      ? db.consenterMember.findUnique({
          where: { consenterId_userId: { consenterId: request.requester.consenterId, userId } },
        })
      : null,
    db.requesterMember.findUnique({
      where: { requesterId_userId: { requesterId: request.requesterId, userId } },
    }),
  ]);
  const asking = askingPaired ?? (askingOnly ? { role: askingOnly.role, canExport: false } : null);
  const canExport = (seat: { role: string; canExport: boolean } | null) => !!seat && (seat.role === "OWNER" || seat.canExport);
  const isAdmin = !!session.user.adminRole;
  if (!receiving && !asking && !isAdmin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isAdmin && !canExport(receiving) && !canExport(asking))
    return NextResponse.json(
      { error: "You need the export permission on this profile to download its history dossier. Ask an owner of the profile." },
      { status: 403 },
    );

  await db.exportLog.create({
    data: {
      kind: "dossier",
      scope: `request:${request.number}`,
      byUserId: session.userId,
      byName: session.user.name,
    },
  });

  const fee = request.payments[0] ?? null;
  const feeOutcome =
    request.earning?.status === "HELD"
      ? "held until the answer"
      : request.earning?.status === "PENDING" || request.earning?.status === "SETTLED"
        ? `80% released to ${request.consenter.displayName}`
        : request.earning?.status === "REFUNDED" || request.earning?.status === "REVERSED"
          ? `80% refunded to ${request.requester.displayName}`
          : null;

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
      // What the person asking paid the profile through Consent: held, then 80% to the
      // profile on a yes or 80% back otherwise. Null for a free request.
      consentRequestFee: fee
        ? {
            amount: fee.amount.toString(),
            currency: fee.currency,
            outcome: request.earning?.status ?? null,
            refunded: fee.refundedAmount?.toString() ?? null,
          }
        : null,
      denialReason: request.denialReason,
    },
    files: request.files.map((f) => ({ kind: f.kind, name: f.name, version: f.version, sha256: f.sha256, uploadedAt: f.createdAt })),
    messages: request.messages.map((m) => ({ at: m.createdAt, by: m.sender.name, side: m.senderSide, body: m.body })),
    events: request.events
      .filter(shownEvent)
      .map((e) => ({ at: e.createdAt, type: e.type, actor: e.actorName, side: e.actorSide, detail: e.detail })),
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
  kv(doc, "Profile asked", `${request.consenter.legalName} ("${request.consenter.displayName}")`);
  kv(doc, "Asked by", `${request.requester.legalName} ("${request.requester.displayName}")`);
  kv(doc, "Status", statusLabel(request.status));
  kv(doc, "Asset types", request.assetTypeNames.join(", "));
  kv(doc, "Consent request fee", fee ? `${fmtMoney(fee.amount.toString(), fee.currency)}${feeOutcome ? ` — ${feeOutcome}` : ""}` : "Free");
  sectionTitle(doc, "File versions & hashes");
  for (const f of dossier.files) para(doc, `${f.kind} v${f.version} — ${f.name}\nsha256:${f.sha256}`, 7);
  // Messages were replaced by "Ask"; older requests may still have some.
  if (dossier.messages.length) {
    sectionTitle(doc, "Messages");
    // Each sender with the profile they wrote for, by name (never by side).
    const sideName = (side: string) =>
      side === "consenter" ? request.consenter.displayName : side === "requester" ? request.requester.displayName : "Consent";
    for (const m of dossier.messages.slice(0, 50)) {
      const profile = sideName(m.side);
      const who = profile === m.by ? m.by : `${m.by} (${profile})`;
      para(doc, `[${new Date(m.at).toISOString()}] ${who}: ${m.body}`, 7);
    }
  }
  sectionTitle(doc, "Timeline");
  for (const e of dossier.events) kv(doc, new Date(e.at).toISOString(), `${eventLabel(e.type)}${e.actor ? ` — ${e.actor}` : ""}`);
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
