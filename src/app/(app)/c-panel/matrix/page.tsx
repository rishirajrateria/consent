import Link from "next/link";
import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Input, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { SuccessNote } from "@/components/error-note";
import { saveMatrixAction } from "./actions";
import { cn } from "@/lib/utils";

export const metadata = { title: "Consent matrix" };

export default async function MatrixPage({ searchParams }: PageProps<"/c-panel/matrix">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();
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

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Consent matrix"
        desc="Defaults per platform × format × asset type: allow without asking, ask me, or never allow. Standing rules run before these defaults."
      />
      {sp.saved && <SuccessNote msg="Matrix saved." />}

      <div className="flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Platforms">
        {platforms.map((p) => (
          <Link
            key={p.id}
            href={`/c-panel/matrix?platform=${p.id}`}
            role="tab"
            aria-selected={p.id === platform.id}
            className={cn(
              "whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium",
              p.id === platform.id ? "bg-ink text-white" : "glass-subtle text-ink-soft hover:text-ink"
            )}
          >
            {p.name}
          </Link>
        ))}
      </div>

      <Alert>
        <strong>Legend:</strong> <span className="font-mono">—</span> Ask me (default) ·{" "}
        <span className="font-mono">✓</span> Allowed without asking · <span className="font-mono">✕</span> Never allowed.
        Row options (duration cap, thumbnail, paid default) apply to the whole format row.
      </Alert>

      <form action={saveMatrixAction}>
        <input type="hidden" name="platformId" value={platform.id} />
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
                            className="w-12 cursor-pointer appearance-none rounded-lg border border-ink/10 bg-white/70 py-1.5 text-center font-mono text-sm focus:border-ink/40 focus:outline-none"
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
                        <label className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                          <input type="checkbox" name={`paid_${f.id}`} defaultChecked={opts?.paidDefault ?? false} className="size-3.5 accent-black" />
                          Paid by default
                        </label>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <div className="mt-4">
          <SubmitButton>Save {platform.name} matrix</SubmitButton>
        </div>
      </form>
    </div>
  );
}
