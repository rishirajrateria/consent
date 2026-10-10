"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One choice at a time for the agreement panel: radio-style buttons swap in
 * the matching form, whose own button comes last, so typed input for one
 * choice can't be sent by another choice's button.
 */
export function AgreementChoices({
  label,
  options,
}: {
  label: string;
  options: { key: string; label: string; content: ReactNode }[];
}) {
  const [mode, setMode] = useState(options[0]?.key);
  const current = options.find((o) => o.key === mode) ?? options[0];

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={current?.key === o.key}
            onClick={() => setMode(o.key)}
            className={cn(
              "min-h-10 rounded-xl px-3.5 py-2 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10",
              current?.key === o.key ? "glass-ink" : "border border-ink/10 bg-white/60 text-ink-soft hover:bg-white hover:text-ink"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {current?.content}
    </div>
  );
}
