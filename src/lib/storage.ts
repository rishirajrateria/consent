import { createHash, createHmac } from "crypto";
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import { db } from "./db";
import type { FileKind } from "@prisma/client";

/**
 * Storage provider interface. The local-disk implementation mirrors the shape
 * of an S3 adapter (private bucket + short-lived signed URLs). To move to
 * S3/R2, implement the same interface with pre-signed URLs.
 */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  signedUrl(key: string, filename: string, ttlSec?: number): string;
}

const STORAGE_DIR = process.env.STORAGE_DIR || "./storage";
const SECRET = process.env.SESSION_SECRET || "dev-secret";

class LocalDiskStorage implements StorageProvider {
  async put(key: string, data: Buffer) {
    const full = path.join(STORAGE_DIR, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  async get(key: string) {
    return readFile(path.join(STORAGE_DIR, key));
  }
  signedUrl(key: string, filename: string, ttlSec = 300) {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = createHmac("sha256", SECRET).update(`${key}:${exp}`).digest("hex");
    const q = new URLSearchParams({ key, exp: String(exp), sig, name: filename });
    return `/api/files?${q.toString()}`;
  }
}

export const storage: StorageProvider = new LocalDiskStorage();

export function verifySignedUrl(key: string, exp: string, sig: string): boolean {
  if (parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return false;
  const expect = createHmac("sha256", SECRET).update(`${key}:${exp}`).digest("hex");
  return sig === expect;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/", "application/pdf", "text/plain"];
const ALLOWED_EXACT = [
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
];

export function mimeAllowed(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || ALLOWED_EXACT.includes(mime);
}

/**
 * Stores an uploaded File, computes its SHA-256 server-side and creates the
 * StoredFile record. Includes a malware-scan hook point (no-op scanner).
 */
export async function storeUpload(opts: {
  file: File;
  kind: FileKind;
  uploadedById?: string;
  requestId?: string;
  consenterDocOf?: string;
  requesterDocOf?: string;
  replacesId?: string;
  maxMb?: number;
}) {
  const { file } = opts;
  const maxBytes = (opts.maxMb ?? 200) * 1024 * 1024;
  if (file.size === 0) throw new Error("Empty file");
  if (file.size > maxBytes) throw new Error(`File exceeds ${opts.maxMb ?? 200} MB limit`);
  const mime = file.type || "application/octet-stream";
  if (!mimeAllowed(mime)) throw new Error(`File type not allowed: ${mime}`);

  const buf = Buffer.from(await file.arrayBuffer());
  await malwareScanHook(buf);
  const hash = sha256(buf);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const key = `${opts.kind.toLowerCase()}/${hash.slice(0, 2)}/${hash}-${safeName}`;
  await storage.put(key, buf);

  let version = 1;
  if (opts.replacesId) {
    const prev = await db.storedFile.findUnique({ where: { id: opts.replacesId } });
    version = (prev?.version ?? 0) + 1;
  }

  return db.storedFile.create({
    data: {
      kind: opts.kind,
      name: safeName,
      mime,
      size: file.size,
      sha256: hash,
      storageKey: key,
      version,
      uploadedById: opts.uploadedById,
      requestId: opts.requestId,
      consenterDocOf: opts.consenterDocOf,
      requesterDocOf: opts.requesterDocOf,
      replacesId: opts.replacesId,
    },
  });
}

/** Hook point for a malware scanner (ClamAV, VirusTotal, etc.). No-op in dev. */
async function malwareScanHook(buf: Buffer): Promise<void> {
  // Intentionally a no-op; wire a real scanner here in production.
  void buf;
}
