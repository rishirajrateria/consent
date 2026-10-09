import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getSettings, saveSettings } from "@/lib/settings";
import { PageHeader, Card, Field, Input, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit, verifyAuditChain } from "@/lib/audit";
import { runSweeps } from "@/lib/jobs";

export const metadata = { title: "System settings" };

async function saveAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("settings", "edit");
  const s = await getSettings();
  const num = (k: string, fallback: number) => {
    const v = parseInt(String(formData.get(k) ?? ""), 10);
    return isNaN(v) || v < 1 ? fallback : v;
  };
  s.slaDays = num("slaDays", s.slaDays);
  s.negotiationIdleDays = num("negotiationIdleDays", s.negotiationIdleDays);
  s.takedownResponseDays = num("takedownResponseDays", s.takedownResponseDays);
  s.maxUploadMb = num("maxUploadMb", s.maxUploadMb);
  s.minCreativePlanChars = num("minCreativePlanChars", s.minCreativePlanChars);
  s.requesterMinScoreGate = num("requesterMinScoreGate", s.requesterMinScoreGate);
  await saveSettings(s);
  await audit({ actorId: session.userId, actorName: session.user.name, action: "system_settings_saved", module: "settings" });
  revalidatePath("/admin/settings");
}

async function runJobsAction() {
  "use server";
  await requireAdmin("settings", "edit");
  await runSweeps();
  revalidatePath("/admin/settings");
}

export default async function AdminSettings() {
  await requireAdmin("settings", "view");
  const s = await getSettings();
  const brokenAt = await verifyAuditChain();

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="System settings" />
      <form action={saveAction}>
        <Card className="space-y-3">
          <SectionTitle title="SLA & limits" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Request SLA (days)" hint="Unanswered requests auto-expire; fee forfeited; consenter penalised.">
              <Input name="slaDays" type="number" min={1} defaultValue={s.slaDays} />
            </Field>
            <Field label="Negotiation idle timeout (days)">
              <Input name="negotiationIdleDays" type="number" min={1} defaultValue={s.negotiationIdleDays} />
            </Field>
            <Field label="Takedown response window (days)">
              <Input name="takedownResponseDays" type="number" min={1} defaultValue={s.takedownResponseDays} />
            </Field>
            <Field label="Max upload size (MB)">
              <Input name="maxUploadMb" type="number" min={1} defaultValue={s.maxUploadMb} />
            </Field>
            <Field label="Min creative plan length (chars)">
              <Input name="minCreativePlanChars" type="number" min={1} defaultValue={s.minCreativePlanChars} />
            </Field>
            <Field label="Requester minimum score gate" hint="Requesters below this cannot send requests at all.">
              <Input name="requesterMinScoreGate" type="number" min={0} max={1000} defaultValue={s.requesterMinScoreGate} />
            </Field>
          </div>
          <SubmitButton>Save settings</SubmitButton>
        </Card>
      </form>

      <Card className="space-y-3">
        <SectionTitle title="Background jobs" desc="SLA expiry, grant expiry, takedown windows, renewal reminders. Run by the worker / cron; trigger manually here." />
        <form action={runJobsAction}>
          <SubmitButton variant="secondary">Run all sweeps now</SubmitButton>
        </form>
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Audit chain integrity" />
        {brokenAt === null ? (
          <p className="text-sm">✓ Hash chain intact — no tampering detected.</p>
        ) : (
          <p className="text-sm font-semibold">✕ Chain broken at entry #{brokenAt} — investigate immediately.</p>
        )}
      </Card>
    </div>
  );
}
