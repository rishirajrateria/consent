"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { MatrixPolicy } from "@prisma/client";

export async function saveMatrixAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canEditRules");
  const platformId = String(formData.get("platformId"));
  // Platform tabs submit this form too, so unsaved cells aren't lost when switching.
  const next = String(formData.get("next") ?? "") || platformId;
  const platform = await db.platform.findUnique({
    where: { id: platformId },
    include: { formats: { where: { active: true } } },
  });
  if (!platform) redirect("/c-panel/matrix");

  const [assetTypes, existing] = await Promise.all([
    db.assetType.findMany({ where: { active: true } }),
    db.consentMatrixEntry.findMany({ where: { consenterId: consenter.id, platformId } }),
  ]);
  const current = new Map(existing.map((e) => [`${e.formatId}_${e.assetTypeId}`, e]));
  const ops = [];
  let changed = false;
  for (const format of platform.formats) {
    const durRaw = String(formData.get(`dur_${format.id}`) ?? "").trim();
    const maxDurationSec = durRaw ? Math.max(1, parseInt(durRaw, 10) || 0) : null;
    const thumbnailAllowed = formData.get(`thumb_${format.id}`) === "on";
    for (const at of assetTypes) {
      const policy = String(formData.get(`policy_${format.id}_${at.id}`) ?? "ASK") as MatrixPolicy;
      if (!["AUTO_APPROVE", "ASK", "AUTO_DENY"].includes(policy)) continue;
      // Note any difference (an unset cell reads as Ask with default row options),
      // but always write every cell so the stored matrix stays complete.
      const was = current.get(`${format.id}_${at.id}`) ?? { policy: "ASK", maxDurationSec: null, thumbnailAllowed: true };
      if (was.policy !== policy || was.maxDurationSec !== maxDurationSec || was.thumbnailAllowed !== thumbnailAllowed)
        changed = true;
      ops.push(
        db.consentMatrixEntry.upsert({
          where: {
            consenterId_platformId_formatId_assetTypeId: {
              consenterId: consenter.id,
              platformId,
              formatId: format.id,
              assetTypeId: at.id,
            },
          },
          update: { policy, maxDurationSec, thumbnailAllowed },
          create: {
            consenterId: consenter.id,
            platformId,
            formatId: format.id,
            assetTypeId: at.id,
            policy,
            maxDurationSec,
            thumbnailAllowed,
          },
        })
      );
    }
  }
  // Save pressed: always write. Tab switch: write only if something was edited.
  const pressedSave = !formData.get("next");
  if (changed || pressedSave) {
    await db.$transaction(ops);
    await audit({
      actorId: session.userId,
      actorName: session.user.name,
      action: "consent_matrix_saved",
      module: "consent_settings",
      targetId: consenter.id,
      detail: { platform: platform.name },
    });
  }
  // Confirm when something changed, or when Save itself was pressed.
  const saved = changed || pressedSave;
  redirect(`/c-panel/matrix?platform=${encodeURIComponent(next)}${saved ? `&saved=${platformId}` : ""}`);
}
