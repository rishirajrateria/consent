import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, hasAdminPerm } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { ensureAsker } from "@/lib/profiles";
import { profileScore } from "@/lib/profiles-pure";
import { PageHeader, Card, Field, Input, SectionTitle, Select, Button } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { audit } from "@/lib/audit";
import { unclampedScore } from "@/lib/score";
import { fmtDateTime, cn } from "@/lib/utils";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { NoPermission } from "../no-permission";

export const metadata = { title: "Consent Score" };

/*
 * People see ONE Consent Score per profile (profileScore: the average of two
 * parts). Underneath, the profile keeps a part for how it answers requests
 * (the profile itself) and a part for how it asks (its sending half). This
 * page edits the weights of both parts and corrects either part by hand.
 */

type Part = "answering" | "asking";
const PART_LABEL: Record<Part, string> = { answering: "How they answer", asking: "How they ask" };

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

/**
 * Sets one part of a profile's score. The change is kept as a manual offset,
 * so recalculation doesn't undo it (see lib/score).
 */
async function manualAdjustAction(formData: FormData) {
  "use server";
  const session = await requireAdmin("scores", "edit");
  const part: Part = String(formData.get("part")) === "asking" ? "asking" : "answering";
  const id = String(formData.get("id") ?? "");
  const find = String(formData.get("find") ?? "");
  const raw = String(formData.get("score") ?? "").trim();
  const newScore = Number(raw);
  const reason = String(formData.get("reason") ?? "").trim();
  const back = (key: "error" | "done", msg: string) =>
    redirect(`/admin/scores?${new URLSearchParams({ find, id, part, [key]: msg })}#adjust`);
  if (!raw || !Number.isInteger(newScore) || newScore < 0 || newScore > 1000)
    back("error", "Enter a whole number from 0 to 1000.");
  if (!reason) back("error", "Add a reason. It shows in the score history.");
  const profile = await db.consenterProfile.findUnique({ where: { id } });
  if (!profile) return back("error", "That profile no longer exists. Find it again.");
  const kind = part === "answering" ? "consenter" : "requester";
  const half = part === "answering" ? profile : await ensureAsker(profile.id);
  // Log the unclamped formula value (not the stored, clamped score) as the old score:
  // the delta is then exactly the offset recalculation needs to land on newScore.
  const before = (await unclampedScore(kind, half.id)) ?? half.score;
  if (half.score === newScore && before === newScore)
    back("error", `${profile.displayName}'s "${PART_LABEL[part].toLowerCase()}" part is already ${newScore}.`);
  const log = { oldScore: before, newScore, reason: `Manual: ${reason}`, adjustedById: session.userId };
  if (part === "answering") {
    await db.$transaction([
      db.consenterProfile.update({ where: { id: half.id }, data: { score: newScore } }),
      db.scoreLog.create({ data: { consenterId: half.id, ...log } }),
    ]);
  } else {
    await db.$transaction([
      db.requesterProfile.update({ where: { id: half.id }, data: { score: newScore } }),
      db.scoreLog.create({ data: { requesterId: half.id, ...log } }),
    ]);
  }
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "score_manual_adjust",
    module: "scores",
    targetId: profile.id,
    detail: { part, halfId: half.id, oldScore: half.score, formulaScore: before, newScore },
    reason,
  });
  revalidatePath("/admin/scores");
  back("done", `${profile.displayName}, ${PART_LABEL[part].toLowerCase()}: ${half.score} → ${newScore}. Later recalculations keep this correction.`);
}

/** A manual log's old score is the unclamped formula value; show it as the 0–1000 score people saw. */
const shownScore = (n: number) => Math.max(0, Math.min(1000, n));

export default async function AdminScores({ searchParams }: PageProps<"/admin/scores">) {
  const session = await requireAdmin("scores", "view");
  const canEdit = hasAdminPerm(session.user.adminRole, "scores", "edit");
  const sp = await searchParams;
  const s = await getSettings();

  // Manual adjustment, step 1: find the profile and show its score, both parts and recent changes.
  const find = typeof sp.find === "string" ? sp.find.trim() : "";
  const pickedId = typeof sp.id === "string" ? sp.id : "";
  const part: Part = sp.part === "asking" ? "asking" : "answering";
  const select = {
    id: true,
    displayName: true,
    slug: true,
    score: true,
    asker: { select: { id: true, score: true } },
  } as const;
  const matches = find
    ? await db.consenterProfile.findMany({
        where: { OR: [{ slug: find }, { displayName: { contains: find, mode: "insensitive" } }] },
        select,
        take: 6,
        orderBy: { displayName: "asc" },
      })
    : [];
  const picked = pickedId
    ? await db.consenterProfile.findUnique({ where: { id: pickedId }, select })
    : matches.length === 1
      ? matches[0]
      : null;
  const pickedLogs = picked
    ? await db.scoreLog.findMany({
        where: { OR: [{ consenterId: picked.id }, ...(picked.asker ? [{ requesterId: picked.asker.id }] : [])] },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { adjustedBy: true },
      })
    : [];
  const pickHref = (id: string) => `/admin/scores?${new URLSearchParams({ find, id })}#adjust`;
  const logs = await db.scoreLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { consenter: true, requester: { include: { consenter: true } }, adjustedBy: true },
  });

  const askingFields: [string, string, number][] = [
    ["r_perApprovedGrant", "Points per certificate received", s.score.requester.perApprovedGrant],
    ["r_approvalRatioMax", "Max points from approval ratio", s.score.requester.approvalRatioMax],
    ["r_upheldReportPenalty", "Upheld report penalty", s.score.requester.upheldReportPenalty],
    ["r_revocationPenalty", "Revocation penalty", s.score.requester.revocationPenalty],
    ["r_takedownIgnoredPenalty", "Takedown ignored or declined penalty", s.score.requester.takedownIgnoredPenalty],
    ["r_changesRequestedPenalty", "Penalty per question asked of them", s.score.requester.changesRequestedPenalty],
    ["r_accountAgeMax", "Max points from account age", s.score.requester.accountAgeMax],
  ];
  const answeringFields: [string, string, number][] = [
    ["c_unansweredPenalty", "Penalty per unanswered (expired) request", s.score.consenter.unansweredPenalty],
    ["c_responseRateMax", "Max points from answer rate", s.score.consenter.responseRateMax],
    ["c_fastResponseMax", "Max points from fast median answer", s.score.consenter.fastResponseMax],
    ["c_pendingTakedownPenalty", "Pending takedown confirmation penalty", s.score.consenter.pendingTakedownPenalty],
    ["c_upheldReportPenalty", "Upheld report penalty", s.score.consenter.upheldReportPenalty],
    ["c_profileCompletenessMax", "Max points from terms completeness", s.score.consenter.profileCompletenessMax],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Admin"
        title="Consent Score"
        desc="Every profile shows one Consent Score: the average of how it answers requests and how it asks. All weights are editable; every change is logged with its reason."
      />
      <form action={saveWeightsAction}>
        <fieldset disabled={!canEdit} className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <SectionTitle title="How they answer" desc="Requests they receive." />
            <Field label="Base score (each part)">
              <Input name="base" type="number" defaultValue={s.score.base} />
            </Field>
            {answeringFields.map(([k, label, v]) => (
              <Field key={k} label={label}>
                <Input name={k} type="number" step="0.1" defaultValue={v} />
              </Field>
            ))}
          </Card>
          <Card className="space-y-3">
            <SectionTitle title="How they ask" desc="Requests they send." />
            {askingFields.map(([k, label, v]) => (
              <Field key={k} label={label}>
                <Input name={k} type="number" step="0.1" defaultValue={v} />
              </Field>
            ))}
            {canEdit ? (
              <SubmitButton className="mt-2">Save weights</SubmitButton>
            ) : (
              <NoPermission to="change weights" perm="edit" module="scores" />
            )}
          </Card>
        </fieldset>
      </form>

      <Card id="adjust" className="space-y-4">
        <SectionTitle title="Manual adjustment" desc="Find the profile, check its score and both parts, then set one part with a reason." />
        <ErrorNote error={sp.error} />
        {typeof sp.done === "string" && <SuccessNote msg={sp.done} />}
        {canEdit ? (
          <>
            <form method="GET" action="/admin/scores#adjust" className="flex flex-wrap items-end gap-2">
              <div className="min-w-44 flex-1">
                <Field label="Profile name or slug" required>
                  <Input name="find" required defaultValue={find} placeholder="Acme Clips" />
                </Field>
              </div>
              <Button type="submit" variant="secondary">Find</Button>
            </form>

            {find && matches.length === 0 && !picked && (
              <p className="text-sm text-ink-soft">
                No profile matches &ldquo;{find}&rdquo;. Check the spelling or try the slug.
              </p>
            )}
            {matches.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium uppercase tracking-wider text-ink-soft">Pick one</div>
                <div className="flex flex-wrap gap-2">
                  {matches.map((m) => (
                    <Link
                      key={m.id}
                      href={pickHref(m.id)}
                      aria-current={picked?.id === m.id ? "true" : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm",
                        picked?.id === m.id ? "border-ink bg-ink text-white" : "border-ink/15 hover:border-ink/40"
                      )}
                    >
                      {m.displayName}{" "}
                      <span className="font-mono text-xs opacity-70">{profileScore(m.score, m.asker?.score)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {picked && (
              <div className="space-y-3 border-t hairline pt-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{picked.displayName}</span>
                  <span className="text-xs text-ink-faint">/{picked.slug}</span>
                  <span className="ml-auto text-sm">
                    Consent Score{" "}
                    <span className="font-mono font-semibold">{profileScore(picked.score, picked.asker?.score)}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
                  <span>
                    How they answer <span className="font-mono font-semibold text-ink">{picked.score}</span>
                  </span>
                  <span>
                    How they ask{" "}
                    <span className="font-mono font-semibold text-ink">{picked.asker ? picked.asker.score : "—"}</span>
                  </span>
                </div>
                {pickedLogs.length > 0 ? (
                  <ul className="space-y-1 text-xs text-ink-soft">
                    {pickedLogs.map((l) => (
                      <li key={l.id}>
                        <span className="font-mono">{shownScore(l.oldScore)} → {l.newScore}</span> ·{" "}
                        {l.consenterId ? "answering" : "asking"} · {l.reason} ·{" "}
                        <span className="text-ink-faint">{l.adjustedBy ? `${l.adjustedBy.name} · ` : ""}{fmtDateTime(l.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-faint">No score changes yet.</p>
                )}
                <form action={manualAdjustAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={picked.id} />
                  <input type="hidden" name="find" value={find} />
                  <Field label="Part" required>
                    <Select name="part" defaultValue={part}>
                      <option value="answering">{PART_LABEL.answering}</option>
                      <option value="asking">{PART_LABEL.asking}</option>
                    </Select>
                  </Field>
                  <div className="w-28">
                    <Field label="New score" required>
                      <Input name="score" type="number" min={0} max={1000} step={1} required />
                    </Field>
                  </div>
                  <div className="min-w-44 flex-1">
                    <Field label="Reason" required>
                      <Input name="reason" required placeholder="Why?" />
                    </Field>
                  </div>
                  <SubmitButton>Adjust</SubmitButton>
                </form>
              </div>
            )}
          </>
        ) : (
          <NoPermission to="adjust scores" perm="edit" module="scores" />
        )}
      </Card>

      <Card className="space-y-2">
        <SectionTitle title="Recent score changes" />
        {logs.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 border-t hairline py-2 text-sm first:border-t-0">
            <span className="font-medium">
              {l.consenter?.displayName ?? l.requester?.consenter?.displayName ?? l.requester?.displayName}
            </span>
            <span className="text-xs text-ink-faint">{l.consenterId ? "answering" : "asking"}</span>
            <span className="font-mono text-xs">{shownScore(l.oldScore)} → {l.newScore}</span>
            <span className="text-xs text-ink-soft">{l.reason}</span>
            <span className="ml-auto text-xs text-ink-faint">{l.adjustedBy ? `${l.adjustedBy.name} · ` : ""}{fmtDateTime(l.createdAt)}</span>
          </div>
        ))}
        {logs.length === 0 && <p className="text-sm text-ink-faint">No changes yet.</p>}
      </Card>
    </div>
  );
}
