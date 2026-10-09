import { db } from "@/lib/db";
import { verifyPayload } from "@/lib/signing";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { fmtDate } from "@/lib/utils";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Consent — live verification", robots: { index: false } };

/**
 * Embeddable live-status widget: a minimal, iframe-friendly card that
 * re-verifies the certificate signature on every load.
 *   <iframe src=".../embed/{id}" width="340" height="120" style="border:0" />
 */
export default async function EmbedPage({ params }: PageProps<"/embed/[publicId]">) {
  const { publicId } = await params;
  const grant = await db.grant.findUnique({
    where: { publicId },
    include: { request: { include: { consenter: true, requester: true } } },
  });

  if (!grant) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-3">
        <div className="glass w-full max-w-sm px-4 py-3 text-sm text-ink-soft">Unknown Consent certificate.</div>
      </div>
    );
  }
  const signatureValid = verifyPayload(grant.payload, grant.signature, grant.publicKey);
  const effectiveStatus =
    grant.status === "ACTIVE" && grant.validUntil && grant.validUntil < new Date() ? "EXPIRED" : grant.status;
  const ok = signatureValid && effectiveStatus === "ACTIVE";

  return (
    <div className="flex min-h-dvh items-center justify-center p-3">
      <a
        href={`${process.env.APP_URL ?? ""}/v/${grant.publicId}`}
        target="_blank"
        rel="noreferrer"
        className="glass-strong block w-full max-w-sm px-4 py-3 no-underline transition-shadow hover:shadow-glass-lg"
      >
        <div className="flex items-center gap-3">
          {ok ? (
            <ShieldCheck className="size-8 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
          ) : (
            <ShieldAlert className="size-8 shrink-0 text-ink" strokeWidth={1.5} aria-hidden />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">
              {ok ? "Consent verified" : signatureValid ? `Consent: ${effectiveStatus.toLowerCase()}` : "Signature invalid"}
            </div>
            <div className="truncate text-xs text-ink-soft">
              {grant.request.requester.displayName} ← {grant.request.consenter.displayName}
            </div>
            <div className="text-[10px] text-ink-faint">
              {grant.certificateId} · issued {fmtDate(grant.issuedAt)} · authenticity checked live
            </div>
          </div>
        </div>
      </a>
    </div>
  );
}
