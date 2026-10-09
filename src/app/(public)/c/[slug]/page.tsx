import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { Card, VerifiedBadge, ScoreRing, ButtonLink, SectionTitle } from "@/components/ui";
import { titleCase, fmtMoney } from "@/lib/utils";
import { storage } from "@/lib/storage";
import { Check, X, CircleDashed } from "lucide-react";
import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps<"/c/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = await db.consenterProfile.findUnique({ where: { slug } });
  if (!c || c.status !== "APPROVED") return { title: "Profile" };
  return {
    title: `${c.displayName} — verified consenter`,
    description: `Request permission to use ${c.displayName}'s likeness through Consent.`,
    openGraph: { title: c.displayName, description: c.bio ?? undefined, type: "profile" },
  };
}

export default async function PublicConsenterPage({ params }: PageProps<"/c/[slug]">) {
  const { slug } = await params;
  const c = await db.consenterProfile.findUnique({
    where: { slug },
    include: { matrixEntries: true },
  });
  if (!c || c.status !== "APPROVED") notFound();
  const photo = c.photoFileId ? await db.storedFile.findUnique({ where: { id: c.photoFileId } }) : null;
  const photoUrl = photo ? storage.signedUrl(photo.storageKey, photo.name, 3600) : null;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": c.entityType === "PERSON" ? "Person" : "Organization",
    name: c.displayName,
    alternateName: c.aliases,
    description: c.bio ?? undefined,
    url: `${process.env.APP_URL ?? ""}/c/${c.slug}`,
  };

  const session = await getSession();

  const [decided, expired, decidedTimes] = await Promise.all([
    db.consentRequest.count({ where: { consenterId: c.id, decidedAt: { not: null } } }),
    db.consentRequest.count({ where: { consenterId: c.id, status: "EXPIRED_NO_RESPONSE" } }),
    db.consentRequest.findMany({
      where: { consenterId: c.id, decidedAt: { not: null }, submittedAt: { not: null } },
      select: { submittedAt: true, decidedAt: true },
      take: 100,
      orderBy: { decidedAt: "desc" },
    }),
  ]);
  const total = decided + expired;
  const responseRate = total > 0 ? Math.round((decided / total) * 100) : null;
  let medianHours: number | null = null;
  if (decidedTimes.length) {
    const hours = decidedTimes
      .map((r) => (r.decidedAt!.getTime() - r.submittedAt!.getTime()) / 3600_000)
      .sort((a, b) => a - b);
    medianHours = Math.round(hours[Math.floor(hours.length / 2)]);
  }

  // Summarize matrix: platform → assetType → aggregated policy across formats
  const platforms = await db.platform.findMany({
    where: { id: { in: [...new Set(c.matrixEntries.map((e) => e.platformId))] } },
    orderBy: { sortOrder: "asc" },
  });
  const assetTypes = await db.assetType.findMany({ orderBy: { sortOrder: "asc" } });
  const assetName = new Map(assetTypes.map((a) => [a.id, a.name]));

  const summary = platforms.map((p) => {
    const entries = c.matrixEntries.filter((e) => e.platformId === p.id);
    const byAsset = new Map<string, string[]>();
    for (const e of entries) {
      byAsset.set(e.assetTypeId, [...(byAsset.get(e.assetTypeId) ?? []), e.policy]);
    }
    const chips = [...byAsset.entries()].map(([assetTypeId, policies]) => {
      const policy = policies.every((x) => x === "AUTO_APPROVE")
        ? "allowed"
        : policies.every((x) => x === "AUTO_DENY")
          ? "never"
          : "ask";
      return { name: assetName.get(assetTypeId) ?? "?", policy };
    });
    return { platform: p.name, chips: chips.filter((ch) => ch.policy !== "ask").concat(chips.filter((ch) => ch.policy === "ask")) };
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Card strong className="fade-up space-y-4 p-7">
        <div className="flex flex-wrap items-start gap-4">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={`${c.displayName} profile photo`} className="size-16 rounded-3xl object-cover" width={64} height={64} />
          ) : (
            <div className="flex size-16 items-center justify-center rounded-3xl bg-ink/5 text-2xl font-semibold">
              {c.displayName.charAt(0)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{c.displayName}</h1>
              <VerifiedBadge />
            </div>
            <div className="mt-0.5 text-sm text-ink-soft">
              {titleCase(c.entityType)}
              {c.category ? ` · ${c.category}` : ""} · {c.country}
              {c.aliases.length > 0 && <span className="text-ink-faint"> · aka {c.aliases.join(", ")}</span>}
            </div>
            {c.bio && <p className="mt-2 text-sm text-ink-soft">{c.bio}</p>}
          </div>
          <ScoreRing score={c.score} />
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t hairline pt-3 text-xs text-ink-soft">
          {responseRate != null && <span>Responds to <strong className="text-ink">{responseRate}%</strong> of requests</span>}
          {medianHours != null && <span>Median response <strong className="text-ink">{medianHours < 48 ? `${medianHours}h` : `${Math.round(medianHours / 24)}d`}</strong></span>}
          <span><strong className="text-ink">{decided}</strong> requests decided</span>
          <span>
            Asking costs{" "}
            <strong className="text-ink">
              {c.consentPrice ? fmtMoney(c.consentPrice.toString(), c.consentPriceCurrency) : "nothing"}
            </strong>
            {c.consentPrice ? " — set by the owner, paid when you submit" : ""}
          </span>
        </div>
        <ButtonLink href={session ? `/r-panel/new?consenter=${c.slug}` : `/signup`} className="w-full justify-center sm:w-auto">
          Request consent
        </ButtonLink>
      </Card>

      <Card className="space-y-4">
        <SectionTitle
          title="What's generally allowed"
          desc="Defaults set by the consenter. Your specific request may still be reviewed, negotiated or declined."
        />
        {summary.length === 0 && (
          <p className="text-sm text-ink-faint">No public defaults yet — every request is reviewed individually.</p>
        )}
        <div className="space-y-4">
          {summary.map((row) => (
            <div key={row.platform}>
              <div className="mb-1.5 text-sm font-semibold">{row.platform}</div>
              <div className="flex flex-wrap gap-1.5">
                {row.chips.map((chip) => (
                  <span
                    key={chip.name}
                    className={
                      chip.policy === "allowed"
                        ? "inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-[11px] font-medium text-white"
                        : chip.policy === "never"
                          ? "inline-flex items-center gap-1 rounded-full border border-ink/15 px-2.5 py-1 text-[11px] text-ink-faint line-through"
                          : "inline-flex items-center gap-1 rounded-full border border-dashed border-ink/30 px-2.5 py-1 text-[11px] text-ink-soft"
                    }
                  >
                    {chip.policy === "allowed" ? <Check className="size-3" aria-hidden /> : chip.policy === "never" ? <X className="size-3" aria-hidden /> : <CircleDashed className="size-3" aria-hidden />}
                    {chip.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-faint">
          Solid = allowed without asking · dashed = ask first · crossed = never allowed.
        </p>
      </Card>
    </div>
  );
}
