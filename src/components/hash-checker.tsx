"use client";

import { useState } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { Check, X, FileSearch, Loader2 } from "lucide-react";

/**
 * Client-side file hash checker: hashes a chosen file with WebCrypto SHA-256
 * (the file never leaves the browser) and compares against approved hashes.
 */
export function HashChecker({ hashes }: { hashes: string[] }) {
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
        desc="Pick any file — it's hashed locally in your browser and compared with the approved hashes. Nothing is uploaded."
      />
      <label className="glass-subtle flex cursor-pointer items-center justify-center gap-2 border-dashed px-4 py-8 text-sm text-ink-soft hover:border-ink/25">
        <FileSearch className="size-4" aria-hidden />
        Choose a file to verify
        <input type="file" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {state === "working" && (
        <div className="flex items-center gap-2 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Hashing…
        </div>
      )}
      {state === "match" && (
        <div className="glass-ink flex items-start gap-2 rounded-xl px-4 py-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong>Exact match.</strong> This file is covered by the certificate.
            <div className="mt-1 font-mono text-[10px] opacity-60 break-all">{hash}</div>
          </div>
        </div>
      )}
      {state === "nomatch" && (
        <div className="glass-subtle flex items-start gap-2 border-ink/25 px-4 py-3 text-sm" role="alert">
          <X className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <strong>No match.</strong> This exact file is <em>not</em> covered — even a one-pixel edit
            changes the hash.
            <div className="mt-1 font-mono text-[10px] text-ink-faint break-all">{hash}</div>
          </div>
        </div>
      )}
    </Card>
  );
}
