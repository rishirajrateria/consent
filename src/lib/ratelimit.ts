import "server-only";

/**
 * Sliding-window rate limiter (in-memory, per instance). Protects login, OTP
 * issuance and invite sending from brute force and abuse. For multi-instance
 * deployments swap the Map for Redis behind this same function.
 */
const windows = new Map<string, number[]>();

export function rateLimit(bucket: string, key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const k = `${bucket}:${key}`;
  const hits = (windows.get(k) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    windows.set(k, hits);
    return false;
  }
  hits.push(now);
  windows.set(k, hits);
  // opportunistic cleanup
  if (windows.size > 10_000) {
    for (const [mk, mv] of windows) {
      if (mv.every((t) => now - t > windowMs)) windows.delete(mk);
    }
  }
  return true;
}
