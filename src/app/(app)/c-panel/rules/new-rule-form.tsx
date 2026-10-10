"use client";

import { useState } from "react";
import { Field, Input, Select, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { cn } from "@/lib/utils";
import { createRuleAction } from "./actions";

type Option = { id: string; name: string };
type Snapshot = { action: string; routeTo: string; parts: string[] };

const EMPTY: Snapshot = { action: "", routeTo: "", parts: [] };

const ACTIONS: [string, string][] = [
  ["AUTO_APPROVE", "Approve automatically"],
  ["AUTO_DENY", "Decline automatically"],
  ["ROUTE_TO_MEMBER", "Send to a team member"],
];

/**
 * New standing rule, written as one sentence: which requests it covers first,
 * then what happens (no default), then a plain summary and "Create rule" last.
 * An auto-approve rule with no conditions would approve everything, so it is
 * blocked here (and again on the server).
 */
export function NewRuleForm({
  platforms,
  assetTypes,
  requesterTypes,
  approvers,
}: {
  platforms: (Option & { formats: Option[] })[];
  assetTypes: Option[];
  requesterTypes: Option[];
  approvers: Option[];
}) {
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  const platformName = new Map(platforms.map((p) => [p.id, p.name]));
  const formatName = new Map(platforms.flatMap((p) => p.formats.map((f) => [f.id, `${p.name} ${f.name}`] as const)));
  const assetName = new Map(assetTypes.map((a) => [a.id, a.name]));
  const typeName = new Map(requesterTypes.map((t) => [t.id, t.name]));

  // Mirrors createRuleAction: only filled-in conditions count.
  function read(form: HTMLFormElement): Snapshot {
    const fd = new FormData(form);
    const all = (k: string) => fd.getAll(k).map(String).filter(Boolean);
    const num = (k: string) => parseInt(String(fd.get(k) ?? ""), 10);
    const names = (ids: string[], m: Map<string, string>, sep: string) => ids.map((i) => m.get(i) ?? "?").join(sep);
    const parts: string[] = [];
    const platformIds = all("platformIds");
    const formatIds = all("formatIds");
    const assetTypeIds = all("assetTypeIds");
    const types = all("requesterTypes");
    const categories = String(fd.get("categories") ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    if (platformIds.length) parts.push(`on ${names(platformIds, platformName, " or ")}`);
    if (formatIds.length) parts.push(`as ${names(formatIds, formatName, " or ")}`);
    if (assetTypeIds.length) parts.push(`using only ${names(assetTypeIds, assetName, ", ")}`);
    if (types.length) parts.push(`from ${names(types, typeName, " or ").toLowerCase()} profiles`);
    if (num("maxDurationSec") > 0) parts.push(`up to ${num("maxDurationSec")} seconds`);
    if (num("minScore") > 0) parts.push(`from someone with a Consent Score of ${num("minScore")} or more`);
    if (categories.length) parts.push(`about ${categories.join(" or ")}`);
    if (fd.get("whitelistOnly") === "on") parts.push("from your whitelist");
    return { action: String(fd.get("action") ?? ""), routeTo: String(fd.get("routeToUserId") ?? ""), parts };
  }

  const approveAll = snap.action === "AUTO_APPROVE" && snap.parts.length === 0;
  const who = snap.parts.length ? `Requests ${snap.parts.join(", ")}` : "Every request";
  const routeName = approvers.find((m) => m.id === snap.routeTo)?.name;
  const summary =
    snap.action === "AUTO_APPROVE"
      ? `${who} will be approved automatically.`
      : snap.action === "AUTO_DENY"
        ? `${who} will be declined automatically.`
        : snap.action === "ROUTE_TO_MEMBER"
          ? `${who} will go to ${routeName ?? "the team member you choose"} to answer.`
          : `${who}: choose what happens in step 2.`;

  return (
    <form
      action={createRuleAction}
      onChange={(e) => setSnap(read(e.currentTarget))}
      onReset={() => setSnap(EMPTY)}
      onSubmit={(e) => {
        const s = read(e.currentTarget);
        setSnap(s);
        if (s.action === "AUTO_APPROVE" && s.parts.length === 0) e.preventDefault();
      }}
      className="space-y-5"
    >
      <Field label="Rule name" required>
        <Input name="name" required placeholder="Auto-approve trusted news channels" />
      </Field>

      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">1. When a request…</div>
          <p className="mt-0.5 text-xs text-ink-faint">
            Every condition you fill in must match. Leave one empty to ignore it. To pick more than one item
            in a list, hold Ctrl (Cmd on a Mac).
          </p>
        </div>
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
          <Field label="Who's asking (creator type)">
            <select name="requesterTypes" multiple size={4} className="input-glass">
              {requesterTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
          <div className="space-y-4">
            <Field label="Max duration (seconds)">
              <Input name="maxDurationSec" type="number" min={1} placeholder="30" />
            </Field>
            <Field label="Asker's minimum Consent Score">
              <Input name="minScore" type="number" min={0} max={1000} placeholder="650" />
            </Field>
            <Field label="Content categories" hint="Comma separated.">
              <Input name="categories" placeholder="news, commentary" />
            </Field>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name="whitelistOnly" className="size-4 accent-black" />
              Only people on your whitelist
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t hairline pt-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">2. Then…</div>
        <div role="radiogroup" aria-label="What happens" className="flex flex-wrap gap-2">
          {ACTIONS.map(([value, label]) => (
            <label
              key={value}
              className={cn(
                "relative inline-flex min-h-10 cursor-pointer items-center rounded-xl px-3.5 py-2 text-sm font-medium transition-all has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ink/10",
                snap.action === value
                  ? "glass-ink"
                  : "border border-ink/10 bg-white/60 text-ink-soft hover:bg-white hover:text-ink"
              )}
            >
              <input type="radio" name="action" value={value} required className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        {snap.action === "ROUTE_TO_MEMBER" && (
          <Field label="Send to (a member who can approve)" required>
            <Select name="routeToUserId" defaultValue="" required>
              <option value="" disabled>Choose a team member</option>
              {approvers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div className="glass-subtle space-y-1 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Summary</div>
        <p className="text-sm text-ink">{summary}</p>
      </div>
      {approveAll ? (
        <Alert tone="warn">
          An auto-approve rule needs at least one condition. Choose which requests it covers in step 1.
        </Alert>
      ) : (
        <Alert>
          Auto-approved requests still produce a certificate stating “Approved by standing rule set
          by [you] on [date]”.
        </Alert>
      )}
      <SubmitButton>Create rule</SubmitButton>
    </form>
  );
}
