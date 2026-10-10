import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { verifyPayload } from "@/lib/signing";
import { Card, SectionTitle, StatusBadge, KV, Alert, VerifiedBadge } from "@/components/ui";
import { FileChecker } from "./file-checker";
import { fmtDateTime } from "@/lib/utils";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";
import type { Metadata } from "next";
import type { Selection } from "@/lib/rules";

export async function generateMetadata({ params }: PageProps<"/v/[publicId]">): Promise<Metadata> {
  const { publicId } = await params;
  return {
    title: `Verify consent ${publicId}`,
    description: "Public verification page for a Consent certificate.",
  };
}

export default async function VerificationPage({ params }: PageProps<"/v/[publicId]">) {
  const { publicId } = await params;
  const grant = await db.grant.findUnique({
    where: { publicId },
    include: {
      request: { include: { consenter: true, requester: true } },
      takedowns: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!grant) notFound();

  const signatureValid = verifyPayload(grant.payload, grant.signature, grant.publicKey);
  const payload = grant.payload as {
    scope: { selections: Selection[]; assetTypes: string[]; conditions: string | null; intentCategory: string | null; thumbnailAllowed: boolean };
    fee: { note: string; amount: string | null; currency: string | null };
    agreementMode: { mode: string; agreementSha256: string | null };
    decidedBy: string;
    files: { kind: string; name: string; sha256: string; version: number }[];
  };

  const effectiveStatus =
    grant.status === "ACTIVE" && grant.validUntil && grant.validUntil < new Date() ? "EXPIRED" : grant.status;
  // Same rule as /embed: only a valid seal on an active grant reads as permission.
  const live = signatureValid && effectiveStatus === "ACTIVE";
  const endedAt = effectiveStatus === "REVOKED" ? grant.revokedAt : effectiveStatus === "EXPIRED" ? grant.validUntil : null;
  const notCovered = !signatureValid
    ? "this certificate could not be verified"
    : effectiveStatus === "REVOKED"
      ? `this permission was revoked on ${fmtDateTime(endedAt)}`
      : effectiveStatus === "EXPIRED"
        ? `this permission ended on ${fmtDateTime(endedAt)}`
        : null;
  // Any takedown not yet confirmed down still stands (incl. a rejected "it's down" claim or a refusal).
  const openTakedown = grant.takedowns.find((t) => t.status !== "CONFIRMED");
  const requester = <strong>{grant.request.requester.displayName}</strong>;
  const consenter = (
    <>
      <strong>{grant.request.consenter.displayName}</strong> <VerifiedBadge className="align-middle" />
    </>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Card strong className="fade-up space-y-4 p-7 text-center">
        {live ? (
          <ShieldCheck className="mx-auto size-12" strokeWidth={1.25} aria-hidden />
        ) : (
          <ShieldAlert className="mx-auto size-12" strokeWidth={1.25} aria-hidden />
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Consent certificate</h1>
          <div className="mt-1 font-mono text-sm text-ink-soft">{grant.certificateId}</div>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <StatusBadge status={effectiveStatus} />
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${signatureValid ? "bg-ink text-white" : "border border-ink/30 text-ink"}`}>
            {signatureValid ? "Verified authentic" : "COULD NOT BE VERIFIED — do not trust"}
          </span>
        </div>
        {/* The status decides what this page may claim, so it is said first. */}
        <p className="text-sm text-ink-soft">
          {!signatureValid ? (
            <>The seal on this record doesn&apos;t match. Don&apos;t rely on anything below.</>
          ) : effectiveStatus === "REVOKED" ? (
            <>
              {requester} had permission from {consenter} until {fmtDateTime(endedAt)}. Only content published
              before then is covered.
            </>
          ) : effectiveStatus === "EXPIRED" ? (
            <>
              {requester} had permission from {consenter}. It ended on {fmtDateTime(endedAt)} and no longer covers
              new use.
            </>
          ) : (
            <>
              {requester} has documented permission from {consenter} for the exact scope and files below.
            </>
          )}
        </p>
        {(grant.revokedAt || openTakedown) && (
          <div className="space-y-2 text-left">
            {grant.revokedAt && (
              <Alert tone="warn">
                <strong>Revoked on {fmtDateTime(grant.revokedAt)}.</strong>
                {grant.revokeReason && <> Reason: {grant.revokeReason}</>}
              </Alert>
            )}
            {openTakedown && (
              <Alert tone="warn">
                The owner asked for this content to be taken down on {fmtDateTime(openTakedown.createdAt)}.
              </Alert>
            )}
          </div>
        )}
        <a href={`/api/certificates/${grant.publicId}`} className="glass-ink mx-auto inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium hover:opacity-85">
          <Download className="size-4" aria-hidden /> Download certificate PDF
        </a>
      </Card>

      <Card className="space-y-1">
        <SectionTitle title="Approved scope" />
        <KV k="Platforms & formats" v={payload.scope.selections.map((s) => `${s.platformName} → ${s.formatName}${s.durationSec ? ` (max ${s.durationSec}s)` : ""}`).join("; ")} />
        <KV k="Asset types" v={payload.scope.assetTypes.join(", ")} />
        <KV k="Thumbnail" v={payload.scope.thumbnailAllowed ? "Allowed" : "Not allowed"} />
        <KV k="Intent" v={payload.scope.intentCategory ?? "—"} />
        {payload.scope.conditions && <KV k="Conditions" v={payload.scope.conditions} />}
        <KV k="Validity" v={
          grant.validityKind === "SINGLE_PUBLICATION" ? "Single publication"
          : grant.validityKind === "PERPETUAL" ? "Perpetual"
          : `${fmtDateTime(grant.validFrom)} → ${fmtDateTime(grant.validUntil)}`
        } />
        <KV k="Fee" v={payload.fee.amount ? `${payload.fee.currency} ${payload.fee.amount} — ${payload.fee.note}` : payload.fee.note} />
        <KV k="Agreement mode" v={payload.agreementMode.mode} />
        <KV k="Decided by" v={payload.decidedBy} />
        <KV k="Issued" v={`${fmtDateTime(grant.issuedAt)} (local) · ${grant.issuedAt.toISOString()} (UTC)`} />
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="The exact approved files" desc="This consent covers only these files. Each has a unique digital fingerprint — change anything in a file and it no longer matches." />
        {payload.files.map((f, i) => (
          <div key={i} className="glass-subtle px-4 py-2.5">
            <div className="text-sm font-medium">{f.name} <span className="text-xs text-ink-faint">({f.kind.toLowerCase()}, v{f.version})</span></div>
            <div className="font-mono text-[10px] text-ink-faint break-all">{f.sha256}</div>
          </div>
        ))}
        {payload.agreementMode.agreementSha256 && (
          <div className="glass-subtle px-4 py-2.5">
            <div className="text-sm font-medium">Signed legal agreement</div>
            <div className="font-mono text-[10px] text-ink-faint break-all">{payload.agreementMode.agreementSha256}</div>
          </div>
        )}
      </Card>

      <FileChecker hashes={payload.files.map((f) => f.sha256)} notCovered={notCovered} />

      {grant.takedowns.length > 0 && (
        <Card className="space-y-2">
          <SectionTitle title="Takedown history" />
          {grant.takedowns.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{fmtDateTime(t.createdAt)} — {t.reason}</span>
              <StatusBadge status={t.status} />
            </div>
          ))}
        </Card>
      )}

      <Card className="space-y-2">
        <SectionTitle title="Technical details" desc="For experts and tools: the cryptographic seal (Ed25519 signature) and public key behind this certificate — re-checked live on every page load." />
        <div className="font-mono text-[10px] text-ink-faint break-all">{grant.signature}</div>
        <details>
          <summary className="cursor-pointer text-xs text-ink-soft">Public key</summary>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-ink-faint">{grant.publicKey}</pre>
        </details>
      </Card>

      <p className="text-center text-xs text-ink-faint">
        Verified by <Link href="/home" className="underline underline-offset-4">consent.</Link> — certificate {grant.certificateId}
      </p>
    </div>
  );
}
