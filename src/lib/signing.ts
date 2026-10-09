import {
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createPrivateKey,
  createPublicKey,
} from "crypto";
import { db } from "./db";

/**
 * Platform Ed25519 signing for consent certificates.
 * The keypair is generated once and persisted (in production, keep the private
 * key in a KMS/secret manager; here it lives in the Setting table for dev).
 */

let cached: { privateKeyPem: string; publicKeyPem: string } | null = null;

export async function getSigningKeys() {
  if (cached) return cached;
  const row = await db.setting.findUnique({ where: { key: "signing_keys" } });
  if (row) {
    cached = row.value as { privateKeyPem: string; publicKeyPem: string };
    return cached;
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keys = {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  await db.setting.create({ data: { key: "signing_keys", value: keys } });
  cached = keys;
  return keys;
}

/** Stable stringify: sorts object keys recursively so the payload is canonical. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export async function signPayload(payload: unknown): Promise<{ signature: string; publicKey: string }> {
  const keys = await getSigningKeys();
  const data = Buffer.from(canonicalJson(payload));
  const signature = edSign(null, data, createPrivateKey(keys.privateKeyPem)).toString("base64");
  return { signature, publicKey: keys.publicKeyPem };
}

export function verifyPayload(payload: unknown, signature: string, publicKeyPem: string): boolean {
  try {
    const data = Buffer.from(canonicalJson(payload));
    return edVerify(null, data, createPublicKey(publicKeyPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
