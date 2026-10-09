import { NextRequest, NextResponse } from "next/server";
import { storage, verifySignedUrl } from "@/lib/storage";

/** Serves private files only via short-lived signed URLs (mirrors S3 pre-signed GETs). */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const exp = req.nextUrl.searchParams.get("exp") ?? "";
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "file";
  if (!key || key.includes("..") || !verifySignedUrl(key, exp, sig)) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 403 });
  }
  try {
    const buf = await storage.get(key);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
