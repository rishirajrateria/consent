"use client";

import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { Check, X, FileSearch, Loader2, AlertTriangle } from "lucide-react";

/**
 * Client-side file hash checker for the verification page: hashes a chosen
 * file with WebCrypto SHA-256 (the file never leaves the browser) and compares
 * it against the approved hashes. A match on a revoked, expired or unverified
 * certificate says so instead of claiming the file is covered.
 */
export function FileChecker({ hashes, notCovered }: { hashes: string[]; notCovered?: string | null }) {
  const [state, setState] = useState<"idle" | "working" | "match" | "nomatch">("idle");
  const [hash, setHash] = useState<string>("");

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState("working");
    try {
      const buf = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setHash(hex);
      setState(hashes.includes(hex) ? "match" : "nomatch");
    } catch {
      setState("idle");
    }
  }

  return (
    <Card className="space-y-3">
      <SectionTitle
        title="Check a file against this certificate"
        desc="Pick any file — it's checked on your device against the approved originals. Nothing is uploaded."
      />
      <label className="glass-subtle flex cursor-pointer items-center justify-center gap-2 border-dashed px-4 py-8 text-sm text-ink-soft hover:border-ink/25">
        <FileSearch className="size-4" aria-hidden />
        Choose a file to verify
        <input type="file" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {state === "working" && (
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking…
        </div>
      )}
      {state === "match" && !notCovered && (
        <div className="glass-ink flex items-start gap-2 rounded-xl px-4 py-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong>Exact match.</strong> This is one of the approved files — it&apos;s covered by this certificate.
            <div className="mt-1 font-mono text-[10px] opacity-60 break-all">{hash}</div>
          </div>
        </div>
      )}
      {state === "match" && notCovered && (
        <div className="glass-subtle flex items-start gap-2 border-ink/25 px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong>Exact match.</strong> This is one of the approved files, but {notCovered}.
            <div className="mt-1 font-mono text-[10px] text-ink-faint break-all">{hash}</div>
          </div>
        </div>
      )}
      {state === "nomatch" && (
        <div className="glass-subtle flex items-start gap-2 border-ink/25 px-4 py-3 text-sm" role="alert">
          <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong>No match.</strong> This is <em>not</em> one of the approved files — even a tiny edit
            makes a file count as different.
            <div className="mt-1 font-mono text-[10px] text-ink-faint break-all">{hash}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
