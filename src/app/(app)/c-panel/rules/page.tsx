import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, Select, SectionTitle, StatusBadge, EmptyState, Alert } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { createRuleAction, toggleRuleAction, deleteRuleAction, moveRuleAction } from "./actions";
import { titleCase, fmtDate } from "@/lib/utils";
import type { RuleConditions } from "@/lib/rules";
import { ArrowUp, ArrowDown, Zap } from "lucide-react";

export const metadata = { title: "Standing rules" };

const REQUESTER_TYPES = ["INDIVIDUAL_CREATOR", "NEWS_CHANNEL", "PODCAST", "MEME_PAGE", "MEDIA_HOUSE", "AGENCY", "OTHER"];

export default async function RulesPage({ searchParams }: PageProps<"/c-panel/rules">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();
  const [rules, platforms, assetTypes, members] = await Promise.all([
    db.standingRule.findMany({ where: { consenterId: consenter.id }, orderBy: { priority: "asc" } }),
    db.platform.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { formats: { where: { active: true } } } }),
    db.assetType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.consenterMember.findMany({ where: { consenterId: consenter.id }, include: { user: true } }),
  ]);
  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const formatName = new Map(platforms.flatMap((p) => p.formats.map((f) => [f.id, `${p.name} → ${f.name}`] as [string, string])));
  const assetName = new Map(assetTypes.map((a) => [a.id, a.name]));

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
                  {r.action === "ROUTE_TO_MEMBER" && r.routeToUserId
                    ? `: ${members.find((m) => m.userId === r.routeToUserId)?.user.name ?? "member"}`
                    : ""}{" "}
                  · set by {r.createdByName} on {fmtDate(r.createdAt)}
                </div>
              </div>
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
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-4">
        <SectionTitle title="New rule" desc="All chosen conditions must match. Leave a condition empty to ignore it." />
        <form action={createRuleAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rule name" required>
              <Input name="name" required placeholder="Auto-approve trusted news channels" />
            </Field>
            <Field label="Action" required>
              <Select name="action" defaultValue="AUTO_APPROVE">
                <option value="AUTO_APPROVE">Auto-approve</option>
                <option value="AUTO_DENY">Auto-deny</option>
                <option value="ROUTE_TO_MEMBER">Route to team member</option>
              </Select>
            </Field>
          </div>
          <Field label="Route to (only for routing rules)">
            <Select name="routeToUserId" defaultValue="">
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{m.user.name}</option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Platforms (any selected must cover the request)">
              <select name="platformIds" multiple size={5} className="input-glass">
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Formats (optional — narrows within platforms)">
              <select name="formatIds" multiple size={5} className="input-glass">
                {platforms.flatMap((p) =>
                  p.formats.map((f) => (
                    <option key={f.id} value={f.id}>{p.name} → {f.name}</option>
                  ))
                )}
              </select>
            </Field>
            <Field label="Asset types">
              <select name="assetTypeIds" multiple size={5} className="input-glass">
                {assetTypes.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Requester types">
              <select name="requesterTypes" multiple size={4} className="input-glass">
                {REQUESTER_TYPES.map((t) => (
                  <option key={t} value={t}>{titleCase(t)}</option>
                ))}
              </select>
            </Field>
            <div className="space-y-4">
              <Field label="Max duration (seconds)">
                <Input name="maxDurationSec" type="number" min={1} placeholder="30" />
              </Field>
              <Field label="Minimum requester Consent Score">
                <Input name="minScore" type="number" min={0} max={1000} placeholder="650" />
              </Field>
              <Field label="Content categories" hint="Comma separated.">
                <Input name="categories" placeholder="news, commentary" />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="whitelistOnly" className="size-4 accent-black" />
                Only whitelisted requesters
              </label>
            </div>
          </div>
          <Alert>
            Auto-approved requests still produce a certificate stating “Approved by standing rule set
            by [you] on [date]”.
          </Alert>
          <SubmitButton>Create rule</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
