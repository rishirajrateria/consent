import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle } from "@/components/ui";
import { statusLabel } from "@/lib/utils";
import { revenueByCurrency, fmtRevenue } from "../revenue";
import { profileScore } from "@/lib/profiles-pure";

export const metadata = { title: "Analytics" };

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-44 shrink-0 truncate text-xs text-ink-soft">{label}</span>
      <div className="h-5 flex-1 overflow-hidden rounded-full bg-ink/5">
        <div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} aria-hidden />
      </div>
      <span className="w-10 text-right font-mono text-xs">{value}</span>
    </div>
  );
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86400_000);
}

export default async function AdminAnalytics() {
  await requireAdmin("analytics", "view");
  const thirtyDaysAgo = daysAgo(30);

  const [signups, byStatus, byPlatform, revenue, verifiedProfiles, responseTimes] =
    await Promise.all([
      db.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      db.consentRequest.groupBy({ by: ["status"], _count: true, where: { status: { not: "DRAFT" } } }),
      db.consentRequest.findMany({ where: { status: { not: "DRAFT" } }, select: { selections: true }, take: 500 }),
      // Consent's revenue per currency from payments made in the last 30 days.
      revenueByCurrency({ days: 30 }),
      // The one Consent Score averages both halves, so rank on it after reading both.
      db.consenterProfile.findMany({
        where: { status: "APPROVED" },
        select: { id: true, displayName: true, score: true, asker: { select: { score: true } } },
        orderBy: { score: "desc" },
        take: 200,
      }),
      db.consentRequest.findMany({
        where: { decidedAt: { not: null }, submittedAt: { not: null } },
        select: { submittedAt: true, decidedAt: true },
        take: 200,
      }),
    ]);

  const topProfiles = verifiedProfiles
    .map((p) => ({ id: p.id, name: p.displayName, score: profileScore(p.score, p.asker?.score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const platformCounts = new Map<string, number>();
  for (const r of byPlatform) {
    const sels = r.selections as { platformName: string }[];
    for (const name of new Set(sels?.map((s) => s.platformName) ?? [])) {
      platformCounts.set(name, (platformCounts.get(name) ?? 0) + 1);
    }
  }
  const platformRows = [...platformCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const statusRows = byStatus.map((s) => [statusLabel(s.status), s._count] as const).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...statusRows.map(([, v]) => v));
  const maxPlatform = Math.max(1, ...platformRows.map(([, v]) => v));
  const avgResponseH =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((acc, r) => acc + (r.decidedAt!.getTime() - r.submittedAt!.getTime()) / 3600_000, 0) / responseTimes.length)
      : null;

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Analytics" desc="Platform health at a glance." />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Signups (30d)", signups],
          ["Revenue (30d)", fmtRevenue(revenue)],
          ["Avg response time", avgResponseH != null ? `${avgResponseH}h` : "—"],
          ["Requests total", statusRows.reduce((a, [, v]) => a + v, 0)],
        ].map(([label, value]) => (
          <Card key={String(label)}>
            <div className="text-2xl font-semibold tabular-nums">{String(value)}</div>
            <div className="mt-0.5 text-xs text-ink-soft">{String(label)}</div>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <SectionTitle title="Requests by status" />
          {statusRows.map(([label, v]) => <Bar key={label} label={label} value={v} max={maxStatus} />)}
          {statusRows.length === 0 && <p className="text-sm text-ink-faint">No requests yet.</p>}
        </Card>
        <Card className="space-y-2">
          <SectionTitle title="Requests by platform" />
          {platformRows.map(([label, v]) => <Bar key={label} label={label} value={v} max={maxPlatform} />)}
          {platformRows.length === 0 && <p className="text-sm text-ink-faint">No requests yet.</p>}
        </Card>
        <Card className="space-y-2 lg:col-span-2">
          <SectionTitle title="Top profiles by Consent Score" />
          {topProfiles.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-sm">
              <span>{p.name}</span>
              <span className="font-mono text-xs">{p.score}</span>
            </div>
          ))}
          {topProfiles.length === 0 && <p className="text-sm text-ink-faint">No verified profiles yet.</p>}
        </Card>
      </div>
    </div>
  );
}
