import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SuccessNote } from "@/components/error-note";
import { saveMatrixAction } from "./actions";
import { cn } from "@/lib/utils";
import { permLabel, seatPerms } from "../team/roles";

export const metadata = { title: "Consent matrix" };

export default async function MatrixPage({ searchParams }: PageProps<"/c-panel/matrix">) {
  const sp = await searchParams;
  const { consenter, member } = await requireConsenter();
  const canEdit = seatPerms(member).canEditRules;
  const platforms = await db.platform.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: { formats: { where: { active: true } } },
  });
  const assetTypes = await db.assetType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const platformId = typeof sp.platform === "string" ? sp.platform : platforms[0]?.id;
  const platform = platforms.find((p) => p.id === platformId) ?? platforms[0];
  const entries = await db.consentMatrixEntry.findMany({
    where: { consenterId: consenter.id, platformId: platform.id },
  });
  const cell = new Map(entries.map((e) => [`${e.formatId}_${e.assetTypeId}`, e]));
  const rowOpt = new Map(entries.map((e) => [e.formatId, e]));
  const savedName = platforms.find((p) => p.id === sp.saved)?.name;
  const tabClass = (current: boolean) =>
    cn(
      "inline-flex min-h-10 items-center whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium",
      current ? "bg-ink text-white" : "glass-subtle text-ink-soft hover:text-ink"
    );

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Consent matrix"
        desc="Defaults per platform × format × asset type: allow without asking, ask me, or never allow. Standing rules run before these defaults."
      />
      {sp.saved && <SuccessNote msg={`${savedName ? `${savedName} matrix` : "Matrix"} saved.`} />}

      {/* Pressing Enter in a field submits with the first submit button, so make that a plain save
          rather than the first platform tab. */}
      {canEdit && <button type="submit" form="matrix-form" tabIndex={-1} aria-hidden className="sr-only" />}
      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Platforms">
        {platforms.map((p) =>
          canEdit ? (
            // Switching platform submits this one first, so its unsaved cells aren't lost.
            <button
              key={p.id}
              type={p.id === platform.id ? "button" : "submit"}
              form="matrix-form"
              name="next"
              value={p.id}
              role="tab"
              aria-selected={p.id === platform.id}
              className={cn(tabClass(p.id === platform.id), "cursor-pointer")}
            >
              {p.name}
            </button>
          ) : (
            <Link
              key={p.id}
              href={`/c-panel/matrix?platform=${p.id}`}
              role="tab"
              aria-selected={p.id === platform.id}
              className={tabClass(p.id === platform.id)}
            >
              {p.name}
            </Link>
          )
        )}
      </div>

      <Alert>
        <strong>Legend:</strong> <span className="font-mono">—</span> Ask me (default) ·{" "}
        <span className="font-mono">✓</span> Allowed without asking · <span className="font-mono">✕</span> Never allowed.
        Row options apply to the whole format row. A ✓ still asks you first when the clip is longer than
        the cap, or the request uses a thumbnail you haven&apos;t allowed.
        {canEdit && " Switching platforms saves your changes first."}
      </Alert>

      <form id="matrix-form" action={saveMatrixAction}>
        <input type="hidden" name="platformId" value={platform.id} />
        <fieldset disabled={!canEdit} className="min-w-0">
          <Card className="overflow-x-auto p-0 sm:p-0">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b hairline">
                  <th className="sticky left-0 bg-white/80 p-3 text-left text-xs font-semibold uppercase tracking-wider text-ink-faint backdrop-blur">
                    {platform.name} formats
                  </th>
                  {assetTypes.map((at) => (
                    <th key={at.id} className="p-2 text-center align-bottom">
                      <span className="inline-block max-w-20 text-[10px] font-medium leading-tight text-ink-soft">
                        {at.name}
                      </span>
                    </th>
                  ))}
                  <th className="p-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    Row options
                  </th>
                </tr>
              </thead>
              <tbody>
                {platform.formats.map((f) => {
                  const opts = rowOpt.get(f.id);
                  return (
                    <tr key={f.id} className="border-b hairline last:border-b-0">
                      <td className="sticky left-0 bg-white/80 p-3 font-medium backdrop-blur">{f.name}</td>
                      {assetTypes.map((at) => {
                        const e = cell.get(`${f.id}_${at.id}`);
                        return (
                          <td key={at.id} className="p-1.5 text-center">
                            <select
                              name={`policy_${f.id}_${at.id}`}
                              defaultValue={e?.policy ?? "ASK"}
                              aria-label={`${f.name} × ${at.name}`}
                              className="w-12 cursor-pointer appearance-none rounded-lg border border-ink/10 bg-white/70 py-1.5 text-center font-mono text-sm focus:border-ink/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="ASK">—</option>
                              <option value="AUTO_APPROVE">✓</option>
                              <option value="AUTO_DENY">✕</option>
                            </select>
                          </td>
                        );
                      })}
                      <td className="p-2">
                        <div className="flex min-w-44 flex-col gap-1.5">
                          {f.isTimed && (
                            <Input
                              name={`dur_${f.id}`}
                              type="number"
                              min={1}
                              defaultValue={opts?.maxDurationSec ?? ""}
                              placeholder="Max seconds"
                              className="py-1 text-xs"
                              aria-label={`${f.name} max duration seconds`}
                            />
                          )}
                          <label className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                            <input type="checkbox" name={`thumb_${f.id}`} defaultChecked={opts?.thumbnailAllowed ?? true} className="size-3.5 accent-black" />
                            Thumbnail allowed
                          </label>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </fieldset>
        <div className="mt-4">
          {canEdit ? (
            <SubmitButton>Save {platform.name} matrix</SubmitButton>
          ) : (
            <Alert>You can view these settings. Editing needs the &lsquo;{permLabel("canEditRules")}&rsquo; permission.</Alert>
          )}
        </div>
      </form>
    </div>
  );
}
