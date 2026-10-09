import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Card, ScoreRing, SectionTitle, KV, StatusBadge } from "@/components/ui";
import { titleCase, fmtDate } from "@/lib/utils";
import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps<"/r/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const r = await db.requesterProfile.findUnique({ where: { slug } });
  if (!r || r.status !== "APPROVED") return { title: "Profile" };
  return { title: `${r.displayName} — requester on Consent` };
}

export default async function PublicRequesterPage({ params }: PageProps<"/r/[slug]">) {
  const { slug } = await params;
  const r = await db.requesterProfile.findUnique({ where: { slug } });
  if (!r || r.status !== "APPROVED") notFound();

  const [approved, decided, upheld] = await Promise.all([
    db.consentRequest.count({ where: { requesterId: r.id, status: "APPROVED" } }),
    db.consentRequest.count({ where: { requesterId: r.id, status: { in: ["APPROVED", "DENIED", "CLOSED"] } } }),
    db.report.count({ where: { request: { requesterId: r.id }, bySide: "consenter", status: "UPHELD" } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card strong className="fade-up space-y-4 p-7">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex size-16 items-center justify-center rounded-3xl bg-ink/5 text-2xl font-semibold">
            {r.displayName.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{r.displayName}</h1>
              <StatusBadge status="VERIFIED" />
            </div>
            <div className="mt-0.5 text-sm text-ink-soft">
              {titleCase(r.type)} · {r.country} · member since {fmtDate(r.createdAt)}
            </div>
            {r.description && <p className="mt-2 text-sm text-ink-soft">{r.description}</p>}
          </div>
          <ScoreRing score={r.score} />
        </div>
      </Card>
      <Card className="space-y-1">
        <SectionTitle title="Track record" />
        <KV k="Approved grants" v={approved} />
        <KV k="Requests decided" v={decided} />
        <KV k="Approval ratio" v={decided ? `${Math.round((approved / decided) * 100)}%` : "—"} />
        <KV k="Upheld reports against" v={upheld} />
        <KV k="Categories" v={r.categories.join(", ") || "—"} />
      </Card>
    </div>
  );
}
