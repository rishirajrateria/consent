"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/** Format an ISO moment; without `timeZone` it's the browser's own zone. */
export function formatMoment(
  iso: string,
  opts: { withZone?: boolean; weekday?: boolean; timeZone?: string } = {},
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    ...(opts.weekday ? { weekday: "short" as const } : {}),
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(opts.withZone ? { timeZoneName: "short" as const } : {}),
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  });
}

/**
 * A moment shown in the viewer's own time zone. The server can't know that
 * zone, so it renders UTC (labelled) and the browser swaps in local time as
 * the page loads, without a hydration mismatch.
 */
export function LocalTime({
  iso,
  withZone,
  weekday,
  className,
}: {
  iso: string;
  /** Add the zone's short name, e.g. "GMT+5:30". */
  withZone?: boolean;
  /** Start with the day of the week, e.g. "Wed". */
  weekday?: boolean;
  className?: string;
}) {
  const text = useSyncExternalStore(
    noSubscription,
    () => formatMoment(iso, { withZone, weekday }),
    () => formatMoment(iso, { withZone: true, weekday, timeZone: "UTC" }),
  );
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
