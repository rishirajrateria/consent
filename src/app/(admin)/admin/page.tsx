import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { runSweeps } from "@/lib/jobs";
import { revalidatePath } from "next/cache";
import { revenueByCurrency, fmtRevenue } from "./revenue";

export const metadata = { title: "Overview" };

async function runJobsAction() {
  "use server";
  await requireAdmin();
  await runSweeps();
  revalidatePath("/admin");
}

export default async function AdminOverview({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const sp = await searchParams;
  const [idChecks, openReports, pendingRequests, activeGrants, users, revenue, openTakedowns] =
    await Promise.all([
      // One ID check per profile (the profile half; its sending half follows it).
      db.consenterProfile.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
      db.report.count({ where: { status: { in: ["OPEN", "UNDER_REVIEW"] } } }),
      db.consentRequest.count({ where: { status: "PENDING" } }),
      db.grant.count({ where: { status: "ACTIVE" } }),
      db.user.count(),
      // Consent's revenue per currency: collected, less the refunded 80% and the profiles' 80%.
      revenueByCurrency(),
      db.takedownRequest.count({ where: { status: { in: ["RAISED", "MARKED_DOWN"] } } }),
    ]);

  const stats: [string, string | number, string][] = [
    ["ID checks waiting", idChecks, "/admin/consenters"],
    ["Open reports", openReports, "/admin/reports"],
    ["Open takedowns", openTakedowns, "/admin/takedowns"],
    ["Pending requests", pendingRequests, "/admin/requests"],
    ["Active grants", activeGrants, "/admin/requests?tab=grants"],
    ["Users", users, "/admin/users"],
    ["Revenue (all time)", fmtRevenue(revenue), "/admin/payments"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin"
        title="Overview"
        desc="Queues, system health and quick actions."
        action={
          <form action={runJobsAction}>
            <SubmitButton variant="secondary" size="sm">Run background jobs now</SubmitButton>
          </form>
        }
      />
      {/* requireAdmin(module, perm) sends admins without that permission here. */}
      {sp.denied && (
        <Alert tone="warn">
          Your role doesn&apos;t allow that action, so nothing was changed. Ask a Super Admin for access.
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value, href]) => (
          <Link key={label} href={href as "/admin"} className="group">
            <Card className="transition-all group-hover:shadow-glass-lg">
              <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
              <div className="mt-0.5 text-xs text-ink-soft">{label}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
