import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, PageHeader, SectionTitle } from "@/components/ui";

export const metadata = { title: "Consent badge" };

export default async function BadgePage({ params }: PageProps<"/v/[publicId]/badge">) {
  const { publicId } = await params;
  const grant = await db.grant.findUnique({ where: { publicId } });
  if (!grant) notFound();
  const base = process.env.APP_URL ?? "";
  const url = `${base}/v/${publicId}`;
  const badgeUrl = `${base}/api/badge/${publicId}.svg`;
  const html = `<a href="${url}" rel="noopener"><img src="${badgeUrl}" alt="Consent verified — certificate ${grant.certificateId}" height="28"></a>`;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker={grant.certificateId}
        title="Badge & link"
        desc="Place the link or badge in your video description, caption, show notes or article — it's a terms-of-use obligation for every grant."
      />
      <Card className="space-y-4">
        <SectionTitle title="Preview" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/badge/${publicId}.svg`} alt={`Consent verified badge for ${grant.certificateId}`} height={28} />
      </Card>
      <Card className="space-y-2">
        <SectionTitle title="Short link" />
        <code className="glass-subtle block overflow-x-auto px-4 py-3 font-mono text-xs">{url}</code>
      </Card>
      <Card className="space-y-2">
        <SectionTitle title="HTML embed" />
        <code className="glass-subtle block overflow-x-auto whitespace-pre px-4 py-3 font-mono text-xs">{html}</code>
      </Card>
      <Card className="space-y-2">
        <SectionTitle title="Plain text (for captions)" />
        <code className="glass-subtle block overflow-x-auto px-4 py-3 font-mono text-xs">
          Licensed with consent — verify: {url}
        </code>
      </Card>
      <Card className="space-y-2">
        <SectionTitle title="Live-status iframe" desc="Re-verifies the Ed25519 signature on every load — shows Active / Expired / Revoked in real time." />
        <code className="glass-subtle block overflow-x-auto whitespace-pre px-4 py-3 font-mono text-xs">{`<iframe src="${base}/embed/${publicId}" width="340" height="120" style="border:0" title="Consent verification"></iframe>`}</code>
      </Card>
      <Card className="space-y-2">
        <SectionTitle title="Verification API" desc="For platforms and tools: JSON status, scope, approved file hashes and the signature itself. CORS-open, no key required." />
        <code className="glass-subtle block overflow-x-auto px-4 py-3 font-mono text-xs">GET {base}/api/v1/verify/{publicId}</code>
      </Card>
    </div>
  );
}
