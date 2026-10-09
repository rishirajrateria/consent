import { NextResponse } from "next/server";
import { runSweeps } from "@/lib/jobs";

/** Cron-friendly endpoint that runs all background sweeps once. */
export async function POST() {
  const result = await runSweeps();
  return NextResponse.json({ ok: true, result });
}

export async function GET() {
  const result = await runSweeps();
  return NextResponse.json({ ok: true, result });
}
