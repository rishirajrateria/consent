"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireConsenter } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { MatrixPolicy } from "@prisma/client";

export async function saveMatrixAction(formData: FormData) {
  const { session, consenter } = await requireConsenter("canEditRules");
  const platformId = String(formData.get("platformId"));
  const platform = await db.platform.findUnique({
    where: { id: platformId },
    include: { formats: { where: { active: true } } },
  });
  if (!platform) redirect("/c-panel/matrix");

  const assetTypes = await db.assetType.findMany({ where: { active: true } });
  const ops = [];
  for (const format of platform.formats) {
    const durRaw = String(formData.get(`dur_${format.id}`) ?? "").trim();
    const maxDurationSec = durRaw ? Math.max(1, parseInt(durRaw, 10) || 0) : null;
    const thumbnailAllowed = formData.get(`thumb_${format.id}`) === "on";
    const paidDefault = formData.get(`paid_${format.id}`) === "on";
    for (const at of assetTypes) {
      const policy = String(formData.get(`policy_${format.id}_${at.id}`) ?? "ASK") as MatrixPolicy;
      if (!["AUTO_APPROVE", "ASK", "AUTO_DENY"].includes(policy)) continue;
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
          update: { policy, maxDurationSec, thumbnailAllowed, paidDefault },
          create: {
            consenterId: consenter.id,
            platformId,
            formatId: format.id,
            assetTypeId: at.id,
            policy,
            maxDurationSec,
            thumbnailAllowed,
            paidDefault,
          },
        })
      );
    }
  }
  await db.$transaction(ops);
  await audit({
    actorId: session.userId,
    actorName: session.user.name,
    action: "consent_matrix_saved",
    module: "consent_settings",
    targetId: consenter.id,
    detail: { platform: platform.name },
  });
  redirect(`/c-panel/matrix?platform=${platformId}&saved=1`);
}
