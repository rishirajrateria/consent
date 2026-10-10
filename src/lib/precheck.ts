import { db } from "./db";
import { evaluateAutoDecision, type Selection } from "./rules";

export type BlockedPair = { platformName: string; formatName: string; assetName: string };

/**
 * Read-only check run before payment: the requested platform → format × asset
 * pairs that the consenter's matrix marks "Never allowed" (already public on
 * their profile). It blocks only when the matrix is what onRequestPaid would
 * act on, so a standing rule that applies first is still respected. Standing
 * rules stay private and keep running after payment.
 */
export async function blockedCombinations(opts: {
  consenterId: string;
  requester: { id: string; type: string; score: number; categories: string[] };
  selections: Selection[];
  assetTypeIds: string[];
}): Promise<BlockedPair[]> {
  const { consenterId, selections, assetTypeIds } = opts;
  if (!selections.length || !assetTypeIds.length) return [];
  const decision = await evaluateAutoDecision(opts);
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

/** Plain message for the pay step and the server check. */
export function blockedPayNote(consenterName: string) {
  return `Remove the combinations ${consenterName} never allows before paying.`;
}
