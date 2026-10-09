import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Input } from "@/components/ui";
import { verifyAuditChain } from "@/lib/audit";
import { fmtDateTime } from "@/lib/utils";
import { Search } from "lucide-react";

export const metadata = { title: "Audit log" };

export default async function AdminAudit({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin("audit", "view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [rows, brokenAt] = await Promise.all([
    db.auditLog.findMany({
      where: q
        ? {
            OR: [
              { action: { contains: q, mode: "insensitive" } },
              { module: { contains: q, mode: "insensitive" } },
              { actorName: { contains: q, mode: "insensitive" } },
              { targetId: { contains: q } },
            ],
          }
        : {},
      orderBy: { id: "desc" },
      take: 100,
    }),
    verifyAuditChain(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin"
        title="Immutable audit log"
        desc={
          brokenAt === null
            ? "Append-only, hash-chained. Chain verified intact on this page load."
            : `⚠ CHAIN BROKEN at entry #${brokenAt} — entries after this point may be tampered.`
        }
      />
      <form method="GET" className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
        <Input name="q" defaultValue={q} placeholder="Filter by action, module, actor…" className="pl-10" aria-label="Filter audit log" />
      </form>
      <Card className="divide-y divide-ink/5 p-0 sm:p-0">
        {rows.map((r) => (
          <div key={r.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs text-ink-faint">#{r.id}</span>
              <span className="font-medium">{r.action}</span>
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] uppercase">{r.module}</span>
              <span className="ml-auto text-xs text-ink-faint">{fmtDateTime(r.createdAt)}</span>
            </div>
            <div className="mt-0.5 text-xs text-ink-soft">
              {r.actorName}
              {r.targetId ? ` → ${r.targetId}` : ""}
              {r.reason ? ` · reason: ${r.reason}` : ""}
            </div>
            <div className="mt-0.5 font-mono text-[9px] text-ink-faint break-all">{r.hash}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="px-5 py-8 text-sm text-ink-faint">No entries.</div>}
      </Card>
    </div>
  );
}
