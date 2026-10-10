import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runSweeps } from "@/lib/jobs";

/**
 * Cron-friendly endpoint that runs all background sweeps once.
 *
 * When JOBS_SECRET is set (set it in production), the caller must send it as
 * `Authorization: Bearer <secret>` or an `x-jobs-secret` header; anything
 * else gets 401 and runs nothing. Without it (local dev, the e2e server) the
 * endpoint stays open, as every sweep is idempotent.
 */
function allowed(req: NextRequest): boolean {
  const secret = process.env.JOBS_SECRET;
  if (!secret) return true;
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const given = bearer ?? req.headers.get("x-jobs-secret");
  if (!given) return false;
  // Compare fixed-length digests so the check takes the same time for any guess.
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

async function tick(req: NextRequest) {
  if (!allowed(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runSweeps();
  return NextResponse.json({ ok: true, result });
}

export async function POST(req: NextRequest) {
  return tick(req);
}

export async function GET(req: NextRequest) {
  return tick(req);
}
