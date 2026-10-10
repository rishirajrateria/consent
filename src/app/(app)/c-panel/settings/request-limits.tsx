import type { Capacity } from "@/lib/capacity";
import { LocalTime } from "@/components/local-time";

/**
 * "opens again …": what reopens a paused profile, with the date in the
 * viewer's own time zone. `verb` fits the sentence's subject ("it opens",
 * "they open").
 */
export function OpensAgain({ capacity, verb = "opens" }: { capacity: Capacity; verb?: "opens" | "open" }) {
  const at = capacity.opensAt ? <LocalTime iso={capacity.opensAt.toISOString()} withZone /> : null;
  if (capacity.untilAnswered && at) {
    return <>{verb} again when you answer some of the requests waiting, and not before {at}</>;
  }
  if (capacity.untilAnswered) return <>{verb} again when you answer some of the requests waiting</>;
  if (at) return <>{verb} again {at}</>;
  return null;
}

/** One line: "Taking new requests" or "Paused: {reasons}, opens again {date}." */
export function CapacityLine({ capacity }: { capacity: Capacity }) {
  if (!capacity.paused) {
    return (
      <p className="text-sm" role="status">
        <strong className="font-semibold">Taking new requests.</strong>{" "}
        <span className="text-ink-soft">
          {capacity.open} waiting for your answer · {capacity.counts.daily} in the last 24 hours ·{" "}
          {capacity.counts.weekly} in the last 7 days · {capacity.counts.monthly} in the last 30 days.
        </span>
      </p>
    );
  }
  return (
    <p className="text-sm" role="status">
      <strong className="font-semibold">Paused:</strong> {capacity.reasons.join("; ")},{" "}
      <OpensAgain capacity={capacity} />. Nobody can send you a new request until then.
    </p>
  );
}
