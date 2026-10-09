import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Monochrome SVG badge: /api/badge/{publicId}.svg */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const publicId = file.replace(/\.svg$/, "");
  const grant = await db.grant.findUnique({ where: { publicId } });
  if (!grant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const label = grant.status === "ACTIVE" ? "consent ✓ verified" : `consent · ${grant.status.toLowerCase()}`;
  const width = 12 + label.length * 7 + 12;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" role="img" aria-label="${label}">
  <rect width="${width}" height="28" rx="14" fill="#111111"/>
  <rect x="1" y="1" width="${width - 2}" height="26" rx="13" fill="none" stroke="rgba(255,255,255,0.25)"/>
  <text x="${width / 2}" y="18" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12" font-weight="600" fill="#ffffff" text-anchor="middle">${label}</text>
</svg>`;
  return new NextResponse(svg, {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },
  });
}
