import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ContactChoice } from "../contact-fields";

/**
 * One tick per contact detail, each showing what would be shared. Details the
 * profile doesn't have yet are shown but can't be ticked. Posts "shareField".
 */
export function ContactChoices({ choices }: { choices: ContactChoice[] }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="sr-only">Contact details to share</legend>
      {choices.map((c) => (
        <div key={c.field} className="flex items-start gap-2 text-sm">
          <input
            id={`shareField-${c.field}`}
            type="checkbox"
            name="shareField"
            value={c.field}
            defaultChecked={c.defaultOn}
            disabled={!c.value}
            className="mt-0.5 size-4 shrink-0 accent-black disabled:opacity-40"
          />
          <label htmlFor={`shareField-${c.field}`} className={cn("min-w-0", !c.value && "text-ink-faint")}>
            <span className="font-medium">{c.label}</span>
            {c.value && <span className="break-words text-ink-soft"> · {c.value}</span>}
          </label>
          {!c.value && (
            // A new tab, so nothing typed in the form around it is lost.
            <Link
              href="/c-panel/settings"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-faint underline underline-offset-4 hover:text-ink"
            >
              add it in settings<span className="sr-only"> (opens in a new tab)</span>
            </Link>
          )}
        </div>
      ))}
    </fieldset>
  );
}
