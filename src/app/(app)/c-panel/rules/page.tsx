import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, SectionTitle, StatusBadge, EmptyState, Alert } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { toggleRuleAction, deleteRuleAction, moveRuleAction } from "./actions";
import { NewRuleForm } from "./new-rule-form";
import { titleCase, fmtDate } from "@/lib/utils";
import type { RuleConditions } from "@/lib/rules";
import { ArrowUp, ArrowDown, Zap } from "lucide-react";

export const metadata = { title: "Standing rules" };

const REQUESTER_TYPES = ["INDIVIDUAL_CREATOR", "NEWS_CHANNEL", "PODCAST", "MEME_PAGE", "MEDIA_HOUSE", "AGENCY", "OTHER"];

export default async function RulesPage({ searchParams }: PageProps<"/c-panel/rules">) {
  const sp = await searchParams;
  const { consenter, member } = await requireConsenter();
  const canEdit = member.role === "OWNER" || member.canEditRules;
  const [rules, platforms, assetTypes, members] = await Promise.all([
    db.standingRule.findMany({ where: { consenterId: consenter.id }, orderBy: { priority: "asc" } }),
    db.platform.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { formats: { where: { active: true } } } }),
    db.assetType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.consenterMember.findMany({ where: { consenterId: consenter.id }, include: { user: true } }),
  ]);
  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const formatName = new Map(platforms.flatMap((p) => p.formats.map((f) => [f.id, `${p.name} → ${f.name}`] as [string, string])));
  const assetName = new Map(assetTypes.map((a) => [a.id, a.name]));

  function routedTo(userId: string): string {
    const m = members.find((x) => x.userId === userId);
    if (!m) return "a former member";
    return m.role === "OWNER" || m.canApprove ? m.user.name : `${m.user.name}, who can't answer requests`;
  }

  function describe(c: RuleConditions): string {
    const parts: string[] = [];
    if (c.platformIds?.length) parts.push(`platforms: ${c.platformIds.map((i) => platformName.get(i) ?? "?").join(", ")}`);
    if (c.formatIds?.length) parts.push(`formats: ${c.formatIds.map((i) => formatName.get(i) ?? "?").join(", ")}`);
    if (c.assetTypeIds?.length) parts.push(`assets: ${c.assetTypeIds.map((i) => assetName.get(i) ?? "?").join(", ")}`);
    if (c.requesterTypes?.length) parts.push(`requester type: ${c.requesterTypes.map(titleCase).join(", ")}`);
    if (c.maxDurationSec) parts.push(`duration ≤ ${c.maxDurationSec}s`);
    if (c.minScore) parts.push(`requester score ≥ ${c.minScore}`);
    if (c.categories?.length) parts.push(`categories: ${c.categories.join(", ")}`);
    if (c.whitelistOnly) parts.push("whitelisted requesters only");
    return parts.length ? parts.join(" · ") : "matches every request";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Standing rules"
        desc="Evaluated top-down before the matrix. The first matching rule decides and is recorded on the request and certificate."
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.saved && <SuccessNote msg="Rule saved." />}

      {rules.length === 0 ? (
        <EmptyState icon={Zap} title="No standing rules yet" desc="Example: auto-approve whitelisted news channels using only your name, up to 30 seconds." />
      ) : (
        <div className="space-y-2">
          {rules.map((r, i) => (
            <Card key={r.id} className="flex flex-wrap items-center gap-3 py-4">
              <div className="flex size-7 items-center justify-center rounded-lg bg-ink/5 font-mono text-xs">{i + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {r.name} <StatusBadge status={r.active ? "ACTIVE" : "CLOSED"} />
                </div>
                <div className="text-xs text-ink-soft">{describe(r.conditions as RuleConditions)}</div>
                <div className="mt-0.5 text-[11px] text-ink-faint">
                  → {titleCase(r.action)}
                  {r.action === "ROUTE_TO_MEMBER" && r.routeToUserId ? `: ${routedTo(r.routeToUserId)}` : ""}{" "}
                  · set by {r.createdByName} on {fmtDate(r.createdAt)}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <form action={moveRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button name="dir" value="up" aria-label="Move up" className="rounded-lg p-1.5 hover:bg-ink/5" disabled={i === 0}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button name="dir" value="down" aria-label="Move down" className="rounded-lg p-1.5 hover:bg-ink/5" disabled={i === rules.length - 1}>
                      <ArrowDown className="size-4" />
                    </button>
                  </form>
                  <form action={toggleRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="ghost" size="sm">{r.active ? "Disable" : "Enable"}</SubmitButton>
                  </form>
                  <form action={deleteRuleAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <ConfirmSubmit confirm={`Delete rule "${r.name}"?`} variant="ghost" size="sm">Delete</ConfirmSubmit>
                  </form>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-4">
        <SectionTitle title="New rule" desc="Say which requests the rule covers, then what happens to them." />
        {canEdit ? (
          <NewRuleForm
            platforms={platforms.map((p) => ({
              id: p.id,
              name: p.name,
              formats: p.formats.map((f) => ({ id: f.id, name: f.name })),
            }))}
            assetTypes={assetTypes.map((a) => ({ id: a.id, name: a.name }))}
            requesterTypes={REQUESTER_TYPES.map((t) => ({ id: t, name: titleCase(t) }))}
            // Routed requests need someone who can answer them.
            approvers={members
              .filter((m) => m.role === "OWNER" || m.canApprove)
              .map((m) => ({ id: m.userId, name: m.user.name }))}
          />
        ) : (
          <Alert>You can view these rules. Editing needs the &lsquo;Edit matrix &amp; rules&rsquo; permission.</Alert>
        )}
      </Card>
    </div>
  );
}
