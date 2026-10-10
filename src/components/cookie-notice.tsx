"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

/** Cookie notice: Consent uses only essential cookies (session, security). */
const noSubscription = () => () => {};
function needsNotice() {
  try {
    return !localStorage.getItem("cookie-notice-ack");
  } catch {
    return false; // private mode
  }
}

export function CookieNotice() {
  // Read the browser's saved choice without a render-then-hide flash; the server never shows it.
  const needed = useSyncExternalStore(noSubscription, needsNotice, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (!needed || dismissed) return null;
  return (
    <div className="glass-bar fixed inset-x-3 bottom-20 z-[60] mx-auto max-w-xl rounded-2xl px-4 py-3 md:bottom-4" role="region" aria-label="Cookie notice">
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
        <span className="min-w-0 flex-1">
          Consent uses only essential cookies — your session and security. No trackers.{" "}
          <Link href="/privacy" className="underline underline-offset-4">Privacy</Link>
        </span>
        <button
          className="glass-ink cursor-pointer rounded-xl px-3 py-1.5 text-sm font-medium hover:opacity-85"
          onClick={() => {
            try {
              localStorage.setItem("cookie-notice-ack", "1");
            } catch {
              /* ignore */
            }
            setDismissed(true);
          }}
        >
          Understood
        </button>
      </div>
    </div>
  );
}
