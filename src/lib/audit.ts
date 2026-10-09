import "server-only";
import { createHash } from "crypto";
import { db } from "./db";

/**
 * Append-only, hash-chained audit log. Each entry's hash covers the previous
 * entry's hash plus a canonical serialization of this entry, so any tampering
 * breaks the chain and is detectable by re-walking it.
 */
export async function audit(entry: {
  actorId?: string | null;
  actorName: string;
  action: string;
  module: string;
  targetId?: string | null;
  detail?: unknown;
  reason?: string | null;
  ip?: string | null;
}) {
  // Serialize writes on the chain head.
  await db.$transaction(async (tx) => {
    const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
    const prevHash = last?.hash ?? "GENESIS";
    const canonical = JSON.stringify({
      prevHash,
      actorId: entry.actorId ?? null,
      actorName: entry.actorName,
      action: entry.action,
      module: entry.module,
      targetId: entry.targetId ?? null,
      detail: entry.detail ?? null,
      reason: entry.reason ?? null,
    });
    const hash = createHash("sha256").update(canonical).digest("hex");
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName,
        action: entry.action,
        module: entry.module,
        targetId: entry.targetId ?? null,
        detail: entry.detail === undefined ? undefined : (entry.detail as object),
        reason: entry.reason ?? null,
        ip: entry.ip ?? null,
        prevHash,
        hash,
      },
    });
  });
}

/** Walks the chain and returns the id of the first broken entry, or null if intact. */
export async function verifyAuditChain(): Promise<number | null> {
  const rows = await db.auditLog.findMany({ orderBy: { id: "asc" } });
  let prevHash = "GENESIS";
  for (const r of rows) {
    const canonical = JSON.stringify({
      prevHash,
      actorId: r.actorId,
      actorName: r.actorName,
      action: r.action,
      module: r.module,
      targetId: r.targetId,
      detail: r.detail,
      reason: r.reason,
    });
    const expect = createHash("sha256").update(canonical).digest("hex");
    if (r.prevHash !== prevHash || r.hash !== expect) return r.id;
    prevHash = r.hash;
  }
  return null;
}
