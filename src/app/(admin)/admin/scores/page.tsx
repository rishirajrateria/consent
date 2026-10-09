import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { PageHeader, Card, Field, Input, SectionTitle, Select } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Consent Score" };

async function saveWeightsAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("scores", "edit");
  const s = await getSettings();
  const num = (k: string, fallback: number) => {
    const v = parseFloat(String(formData.get(k) ?? ""));
    return isNaN(v) ? fallback : v;
  };
  s.score.base = num("base", s.score.base);
  const r = s.score.requester;
  r.perApprovedGrant = num("r_perApprovedGrant", r.perApprovedGrant);
  r.approvalRatioMax = num("r_approvalRatioMax", r.approvalRatioMax);
  r.upheldReportPenalty = num("r_upheldReportPenalty", r.upheldReportPenalty);
  r.revocationPenalty = num("r_revocationPenalty", r.revocationPenalty);
  r.takedownIgnoredPenalty = num("r_takedownIgnoredPenalty", r.takedownIgnoredPenalty);
  r.changesRequestedPenalty = num("r_changesRequestedPenalty", r.changesRequestedPenalty);
  r.accountAgeMax = num("r_accountAgeMax", r.accountAgeMax);
  const c = s.score.consenter;
  c.unansweredPenalty = num("c_unansweredPenalty", c.unansweredPenalty);
  c.responseRateMax = num("c_responseRateMax", c.responseRateMax);
  c.fastResponseMax = num("c_fastResponseMax", c.fastResponseMax);
  c.pendingTakedownPenalty = num("c_pendingTakedownPenalty", c.pendingTakedownPenalty);
  c.upheldReportPenalty = num("c_upheldReportPenalty", c.upheldReportPenalty);
  c.profileCompletenessMax = num("c_profileCompletenessMax", c.profileCompletenessMax);
  await saveSettings(s);
  await audit({ actorId: session.userId, actorName: session.user.name, action: "score_weights_saved", module: "scores" });
  revalidatePath("/admin/scores");
}

async function manualAdjustAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("scores", "edit");
  const kind = String(formData.get("kind"));
  const name = String(formData.get("profile") ?? "").trim();
  const newScore = Math.max(0, Math.min(1000, parseInt(String(formData.get("score")), 10) || 0));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;
  if (kind === "consenter") {
    const p = await db.consenterProfile.findFirst({ where: { OR: [{ slug: name }, { displayName: { equals: name, mode: "insensitive" } }] } });
    if (!p) return;
    await db.$transaction([
      db.consenterProfile.update({ where: { id: p.id }, data: { score: newScore } }),
      db.scoreLog.create({ data: { consenterId: p.id, oldScore: p.score, newScore, reason: `Manual: ${reason}`, adjustedById: session.userId } }),
    ]);
  } else {
    const p = await db.requesterProfile.findFirst({ where: { OR: [{ slug: name }, { displayName: { equals: name, mode: "insensitive" } }] } });
    if (!p) return;
    await db.$transaction([
      db.requesterProfile.update({ where: { id: p.id }, data: { score: newScore } }),
      db.scoreLog.create({ data: { requesterId: p.id, oldScore: p.score, newScore, reason: `Manual: ${reason}`, adjustedById: session.userId } }),
    ]);
  }
  await audit({ actorId: session.userId, actorName: session.user.name, action: "score_manual_adjust", module: "scores", targetId: name, reason });
  revalidatePath("/admin/scores");
}

export default async function AdminScores() {
  await requireAdmin("scores", "view");
  const s = await getSettings();
  const logs = await db.scoreLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { consenter: true, requester: true, adjustedBy: true },
  });

  const requesterFields: [string, string, number][] = [
    ["r_perApprovedGrant", "Points per approved grant", s.score.requester.perApprovedGrant],
    ["r_approvalRatioMax", "Max points from approval ratio", s.score.requester.approvalRatioMax],
    ["r_upheldReportPenalty", "Upheld report penalty", s.score.requester.upheldReportPenalty],
    ["r_revocationPenalty", "Revocation penalty", s.score.requester.revocationPenalty],
    ["r_takedownIgnoredPenalty", "Takedown ignored/declined penalty", s.score.requester.takedownIgnoredPenalty],
    ["r_changesRequestedPenalty", "Changes-requested penalty", s.score.requester.changesRequestedPenalty],
    ["r_accountAgeMax", "Max points from account age", s.score.requester.accountAgeMax],
  ];
  const consenterFields: [string, string, number][] = [
    ["c_unansweredPenalty", "Penalty per unanswered (auto-expired) request", s.score.consenter.unansweredPenalty],
    ["c_responseRateMax", "Max points from response rate", s.score.consenter.responseRateMax],
    ["c_fastResponseMax", "Max points from fast median response", s.score.consenter.fastResponseMax],
    ["c_pendingTakedownPenalty", "Pending takedown confirmation penalty", s.score.consenter.pendingTakedownPenalty],
    ["c_upheldReportPenalty", "Upheld report penalty", s.score.consenter.upheldReportPenalty],
    ["c_profileCompletenessMax", "Max points from matrix completeness", s.score.consenter.profileCompletenessMax],
  ];

  return (
    <div className="space-y-6">
      <PageHeader kicker="Admin" title="Consent Score" desc="All weights are admin-editable; every score change is logged with its reason." />
      <form action={saveWeightsAction}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <SectionTitle title="Requester weights" />
            <Field label="Base score (both sides)">
              <Input name="base" type="number" defaultValue={s.score.base} />
            </Field>
            {requesterFields.map(([k, label, v]) => (
              <Field key={k} label={label}>
                <Input name={k} type="number" step="0.1" defaultValue={v} />
              </Field>
            ))}
          </Card>
          <Card className="space-y-3">
            <SectionTitle title="Consenter weights" />
            {consenterFields.map(([k, label, v]) => (
              <Field key={k} label={label}>
                <Input name={k} type="number" step="0.1" defaultValue={v} />
              </Field>
            ))}
            <SubmitButton className="mt-2">Save weights</SubmitButton>
          </Card>
        </div>
      </form>

      <Card className="space-y-3">
        <SectionTitle title="Manual adjustment" desc="Requires a reason; logged in the score history and audit trail." />
        <form action={manualAdjustAction} className="flex flex-wrap items-end gap-2">
          <Field label="Side">
            <Select name="kind" defaultValue="requester">
              <option value="requester">Requester</option>
              <option value="consenter">Consenter</option>
            </Select>
          </Field>
          <div className="min-w-44 flex-1">
            <Field label="Profile name or slug" required>
              <Input name="profile" required placeholder="Acme Clips" />
            </Field>
          </div>
          <div className="w-24">
            <Field label="New score" required>
              <Input name="score" type="number" min={0} max={1000} required />
            </Field>
          </div>
          <div className="min-w-44 flex-1">
            <Field label="Reason" required>
              <Input name="reason" required placeholder="Why?" />
            </Field>
          </div>
          <SubmitButton variant="secondary">Adjust</SubmitButton>
        </form>
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Recent score changes" />
        {logs.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
            <span className="font-medium">{l.consenter?.displayName ?? l.requester?.displayName}</span>
            <span className="font-mono text-xs">{l.oldScore} → {l.newScore}</span>
            <span className="text-xs text-ink-soft">{l.reason}</span>
            <span className="ml-auto text-xs text-ink-faint">{l.adjustedBy ? `${l.adjustedBy.name} · ` : ""}{fmtDateTime(l.createdAt)}</span>
          </div>
        ))}
        {logs.length === 0 && <p className="text-sm text-ink-faint">No changes yet.</p>}
      </Card>
    </div>
  );
}
