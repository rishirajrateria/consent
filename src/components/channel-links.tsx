import { Globe } from "lucide-react";
import { BRAND_PATHS, CHANNEL_LABELS, compactCount, parseChannels, type ChannelKind } from "@/lib/channels";
import { cn } from "@/lib/utils";

/** Monochrome brand mark (fills with the current text colour). */
export function BrandIcon({ kind, className }: { kind: ChannelKind; className?: string }) {
  const d = BRAND_PATHS[kind];
  if (!d) return <Globe className={className} aria-hidden />;
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d={d} />
    </svg>
  );
}

/**
 * A row of tappable channel icons (YouTube, Instagram, X…) that open the
 * person's own profiles in a new tab. Renders nothing when there are no
 * channels with a safe web address.
 */
export function ChannelLinks({ channels, owner, className }: { channels: unknown; owner: string; className?: string }) {
  const list = parseChannels(channels);
  if (list.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label={`${owner}'s channels`}>
      {list.map((c, i) => {
        const label = c.kind === "web" && c.platform ? c.platform : CHANNEL_LABELS[c.kind];
        const count = compactCount(c.followers);
        return (
          <li key={`${c.href}-${i}`}>
            <a
              href={c.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={`${label}${count ? ` · ${count} followers` : ""}`}
              aria-label={`${owner} on ${label}${count ? `, ${count} followers` : ""} (opens in a new tab)`}
              className="glass-subtle inline-flex h-10 items-center gap-2 px-3 text-xs font-medium text-ink transition-all hover:bg-white hover:shadow-glass focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ink/10"
            >
              <BrandIcon kind={c.kind} className="size-[18px] shrink-0" />
              <span className="tabular-nums">{count || label}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
