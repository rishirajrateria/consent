import { revalidatePath } from "next/cache";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, StatusBadge, EmptyState } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { fmtDateTime } from "@/lib/utils";
import { Megaphone } from "lucide-react";

export const metadata = { title: "Tip-offs" };

async function resolveTipAction(formData: FormData) {
  "use server";
  const { consenter } = await requireConsenter();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) === "DISMISSED" ? "DISMISSED" : "REVIEWED";
  await db.publicTipOff.updateMany({ where: { id, consenterId: consenter.id }, data: { status } });
  revalidatePath("/c-panel/tipoffs");
}

export default async function TipOffsPage() {
  const { consenter } = await requireConsenter();
  const tips = await db.publicTipOff.findMany({
    where: { consenterId: consenter.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Public tip-offs"
        desc="Reports from the public about your likeness being used without your consent. Check them against your certificates. If a breach is on a request you approved, report it or ask for a takedown from that request."
      />
      {tips.length === 0 ? (
        <EmptyState icon={Megaphone} title="No tip-offs" desc="Anyone can report misuse from your public profile — no account needed." />
      ) : (
        <div className="space-y-2">
          {tips.map((t) => (
            <Card key={t.id} className="space-y-2 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Megaphone className="size-4" aria-hidden />
                <span className="text-xs text-ink-faint">
                  {fmtDateTime(t.createdAt)}
                  {t.reporterName ? ` · from ${t.reporterName}` : " · anonymous"}
                  {t.reporterEmail ? ` (${t.reporterEmail})` : ""}
                </span>
                <StatusBadge status={t.status === "REVIEWED" ? "APPROVED" : t.status} className="ml-auto" />
              </div>
              <p className="text-sm text-ink-soft">{t.description}</p>
              <div className="space-y-0.5">
                {t.links.map((l) => (
                  <a key={l} href={l} target="_blank" rel="noreferrer" className="block truncate text-xs underline underline-offset-4">
                    {l}
                  </a>
                ))}
              </div>
              {t.status === "OPEN" && (
                <form action={resolveTipAction} className="flex gap-2 border-t hairline pt-2">
                  <input type="hidden" name="id" value={t.id} />
                  <SubmitButton name="status" value="REVIEWED" variant="secondary" size="sm">Mark reviewed</SubmitButton>
                  <SubmitButton name="status" value="DISMISSED" variant="ghost" size="sm">Dismiss</SubmitButton>
                </form>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
