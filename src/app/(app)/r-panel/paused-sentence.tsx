import { LocalTime } from "@/components/local-time";
import { pausedMessage, type Capacity } from "@/lib/capacity";

const MARK = "\u0000";

/**
 * The one sentence a requester sees when an owner has paused new requests
 * (pausedMessage), with the date it opens again shown in the viewer's own
 * time zone. Renders nothing when requests aren't paused.
 */
export function PausedSentence({ name, capacity }: { name: string; capacity: Capacity }) {
  const text = pausedMessage(name, capacity, () => MARK);
  if (!text) return null;
  const [before, after] = text.split(MARK);
  if (after === undefined || !capacity.opensAt) return <>{text}</>;
  return (
    <>
      {before}
      <LocalTime iso={capacity.opensAt.toISOString()} className="font-medium text-ink" />
      {after}
    </>
  );
}
