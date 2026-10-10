import { db } from "./db";
import { evaluateAutoDecision, type Selection } from "./rules";
import { askerScore } from "./requests";

export type BlockedPair = { platformName: string; formatName: string; assetName: string };

/**
 * Read-only check run before a request is sent (before checkout, or before
 * sending a free request): the requested platform → format × asset pairs that
 * the owner's matrix marks "Never allowed" (already public on their profile).
 * It blocks only when the matrix is what onRequestPaid would act on, so a
 * standing rule that applies first is still respected. Standing rules stay
 * private and keep running once the request is sent.
 *
 * Rules compare the asker's Consent Score as everyone sees it (askerScore),
 * read here from the stored halves, the same number onRequestPaid uses, so
 * the check before sending and the real decision always agree whatever
 * score the caller passes.
 */
export async function blockedCombinations(opts: {
  consenterId: string;
  requester: { id: string; type: string; score: number; categories: string[] };
  selections: Selection[];
  assetTypeIds: string[];
}): Promise<BlockedPair[]> {
  const { consenterId, selections, assetTypeIds } = opts;
  if (!selections.length || !assetTypeIds.length) return [];
  const asker = await db.requesterProfile.findUnique({
    where: { id: opts.requester.id },
    select: { score: true, consenter: { select: { score: true } } },
  });
  const requester = asker ? { ...opts.requester, score: askerScore(asker) } : opts.requester;
  const decision = await evaluateAutoDecision({ ...opts, requester });
  if (decision.kind !== "matrix" || decision.policy !== "AUTO_DENY") return [];

  const [entries, assetTypes] = await Promise.all([
    db.consentMatrixEntry.findMany({
      where: {
        consenterId,
        policy: "AUTO_DENY",
        formatId: { in: selections.map((s) => s.formatId) },
        assetTypeId: { in: assetTypeIds },
      },
      select: { platformId: true, formatId: true, assetTypeId: true },
    }),
    db.assetType.findMany({ where: { id: { in: assetTypeIds } }, select: { id: true, name: true } }),
  ]);
  const denied = new Set(entries.map((e) => `${e.platformId}:${e.formatId}:${e.assetTypeId}`));
  const names = new Map(assetTypes.map((a) => [a.id, a.name]));
  const blocked: BlockedPair[] = [];
  for (const sel of selections) {
    for (const at of assetTypeIds) {
      if (denied.has(`${sel.platformId}:${sel.formatId}:${at}`)) {
        blocked.push({ platformName: sel.platformName, formatName: sel.formatName, assetName: names.get(at) ?? "this asset" });
      }
    }
  }
  return blocked;
}

/** Plain message for the send step and the server check. */
export function blockedPayNote(ownerName: string) {
  return `Remove the combinations ${ownerName} never allows before sending.`;
}
