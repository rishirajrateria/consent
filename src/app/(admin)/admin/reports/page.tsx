import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState, Field, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { recalcConsenterScore, recalcRequesterScore } from "@/lib/score";
import { notifyConsenterTeam, notifyRequesterTeam } from "@/lib/notify";
import { fmtDateTime, cn } from "@/lib/utils";
import { Flag, Megaphone } from "lucide-react";
import type { ReportStatus } from "@prisma/client";

export const metadata = { title: "Reports & disputes" };

async function resolveTipAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("reports", "edit");
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) === "DISMISSED" ? "DISMISSED" : "REVIEWED";
  await db.publicTipOff.update({ where: { id }, data: { status, adminNote: String(formData.get("note") ?? "").trim() || undefined } });
  await audit({ actorId: session.userId, actorName: session.user.name, action: `tipoff_${status.toLowerCase()}`, module: "reports", targetId: id });
  revalidatePath("/admin/reports");
}

async function decideReportAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("reports", "approve");
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision")) as ReportStatus;
  const notes = String(formData.get("notes") ?? "").trim();
  if (!["UNDER_REVIEW", "UPHELD", "DISMISSED"].includes(decision)) return;
  const report = await db.report.update({
    where: { id },
    data: { status: decision, adminNotes: notes || undefined, resolvedAt: ["UPHELD", "DISMISSED"].includes(decision) ? new Date() : null },
    include: { request: true },
  });
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: `report_${decision.toLowerCase()}`,
    module: "reports",
    targetId: id,
    reason: notes || null,
  });
  if (decision === "UPHELD" || decision === "DISMISSED") {
    // Upheld reports hit the reported party's score
    if (report.bySide === "consenter") await recalcRequesterScore(report.request.requesterId, `Report ${decision.toLowerCase()}`);
    else await recalcConsenterScore(report.request.consenterId, `Report ${decision.toLowerCase()}`);
    const msg = {
      title: `Report on request #${report.request.number}: ${decision.toLowerCase()}`,
      body: notes || "The Consent review team has decided.",
    };
    await notifyConsenterTeam(report.request.consenterId, { ...msg, href: `/c-panel/requests/${report.requestId}` });
    await notifyRequesterTeam(report.request.requesterId, { ...msg, href: `/r-panel/requests/${report.requestId}` });
  }
  revalidatePath("/admin/reports");
}

const TABS: [string, ReportStatus[] | null][] = [
  ["Open", ["OPEN", "UNDER_REVIEW"]],
  ["Upheld", ["UPHELD"]],
  ["Dismissed", ["DISMISSED"]],
  ["All", null],
];

export default async function AdminReports({ searchParams }: PageProps<"/admin/reports">) {
  await requireAdmin("reports", "view");
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "Open";
  const statuses = TABS.find(([t]) => t === tab)?.[1] ?? TABS[0][1];
  const [reports, tipOffs] = await Promise.all([
    db.report.findMany({
      where: statuses ? { status: { in: statuses } } : {},
      orderBy: { createdAt: "asc" },
      take: 100,
      include: { request: { include: { consenter: true, requester: true } } },
    }),
    db.publicTipOff.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "asc" },
      take: 50,
      include: { consenter: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin · Trust & safety" title="Reports & disputes" />
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map(([t]) => (
          <Link key={t} href={`/admin/reports?tab=${t}`} className={cn("rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap", t === tab ? "bg-ink text-white" : "text-ink-soft hover:bg-ink/5")}>
            {t}
          </Link>
        ))}
      </div>
      {reports.length === 0 ? (
        <EmptyState icon={Flag} title="No reports" />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Flag className="size-4" aria-hidden />
                <span className="font-medium">{r.reason}</span>
                <span className="text-xs text-ink-faint">
                  request #{r.request.number} · {r.request.consenter.displayName} ↔ {r.request.requester.displayName} · filed by {r.bySide} · {fmtDateTime(r.createdAt)}
                </span>
                <StatusBadge status={r.status} className="ml-auto" />
              </div>
              <p className="text-sm text-ink-soft">{r.description}</p>
              {r.evidenceLinks.length > 0 && <p className="text-xs text-ink-faint">Evidence: {r.evidenceLinks.join(" · ")}</p>}
              {r.response && <p className="text-sm text-ink-soft"><strong>Other party&apos;s response:</strong> {r.response}</p>}
              {r.adminNotes && <p className="text-xs text-ink-faint">Admin notes: {r.adminNotes}</p>}
              {(r.status === "OPEN" || r.status === "UNDER_REVIEW") && (
                <form action={decideReportAction} className="space-y-2 border-t hairline pt-3">
                  <input type="hidden" name="id" value={r.id} />
                  <Field label="Notes">
                    <Textarea name="notes" className="min-h-14" placeholder="Reason for the decision…" />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton name="decision" value="UNDER_REVIEW" variant="secondary" size="sm">Under review</SubmitButton>
                    <SubmitButton name="decision" value="UPHELD" size="sm">Uphold</SubmitButton>
                    <SubmitButton name="decision" value="DISMISSED" variant="danger" size="sm">Dismiss</SubmitButton>
                  </div>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone className="size-4" aria-hidden />
          <h2 className="text-lg font-semibold tracking-tight">Open public tip-offs</h2>
        </div>
        {tipOffs.length === 0 && <p className="text-sm text-ink-faint">None open.</p>}
        {tipOffs.map((t) => (
          <div key={t.id} className="space-y-1 border-t hairline py-3 text-sm first:border-t-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.consenter.displayName}</span>
              <span className="text-xs text-ink-faint">
                {fmtDateTime(t.createdAt)} · {t.reporterName ?? "anonymous"}{t.reporterEmail ? ` (${t.reporterEmail})` : ""}
              </span>
            </div>
            <p className="text-ink-soft">{t.description}</p>
            <p className="text-xs text-ink-faint">{t.links.join(" · ")}</p>
            <form action={resolveTipAction} className="flex flex-wrap items-center gap-2 pt-1">
              <input type="hidden" name="id" value={t.id} />
              <input name="note" placeholder="Admin note…" className="input-glass max-w-56 py-1.5 text-xs" aria-label="Admin note" />
              <SubmitButton name="status" value="REVIEWED" variant="secondary" size="sm">Reviewed</SubmitButton>
              <SubmitButton name="status" value="DISMISSED" variant="ghost" size="sm">Dismiss</SubmitButton>
            </form>
          </div>
        ))}
      </Card>
    </div>
  );
}
