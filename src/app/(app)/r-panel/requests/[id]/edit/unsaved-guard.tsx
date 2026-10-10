"use client";

import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { SubmitButton } from "@/components/form";

type Dirty = Record<string, string>; // form key → plain section name

const GuardContext = createContext<{ dirty: Dirty; mark: (key: string, label: string | null) => void } | null>(null);

/**
 * Wraps the request wizard's sections. Each section saves on its own and
 * reloads the page, so typed-but-unsaved input elsewhere would be lost: any
 * other submit asks first, and paying waits until everything is saved.
 */
export function UnsavedGuard({ children, className }: { children: ReactNode; className?: string }) {
  const [dirty, setDirty] = useState<Dirty>({});
  const mark = useCallback((key: string, label: string | null) => {
    setDirty((prev) => {
      if (label ? prev[key] === label : !(key in prev)) return prev;
      const next = { ...prev };
      if (label) next[key] = label;
      else delete next[key];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ dirty, mark }), [dirty, mark]);

  function onSubmitCapture(e: FormEvent<HTMLDivElement>) {
    const form = e.target as HTMLFormElement;
    if (form.dataset.skipUnsavedCheck !== undefined) return;
    const others = Object.entries(dirty)
      .filter(([key]) => key !== form.dataset.section)
      .map(([, label]) => label);
    if (others.length && !window.confirm(`Your changes in ${others.join(" and ")} aren't saved yet and will be lost. Continue?`)) {
      e.preventDefault();
    }
  }

  return (
    <GuardContext.Provider value={value}>
      <div className={className} onSubmitCapture={onSubmitCapture}>
        {children}
      </div>
    </GuardContext.Provider>
  );
}

/** A section form that remembers when it has changes that aren't saved. */
export function TrackedForm({
  section,
  label,
  action,
  children,
}: {
  section: string;
  label: string;
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
}) {
  const ctx = useContext(GuardContext);
  return (
    <form
      action={action}
      data-section={section}
      onChange={() => ctx?.mark(section, label)}
      onSubmit={(e) => {
        if (!e.defaultPrevented) ctx?.mark(section, null);
      }}
      onReset={() => ctx?.mark(section, null)}
    >
      {children}
    </form>
  );
}

/** Shown next to a section's Save button while it has unsaved changes. */
export function UnsavedNote({ section }: { section: string }) {
  const ctx = useContext(GuardContext);
  if (!ctx?.dirty[section]) return null;
  return <span className="text-xs text-ink-soft">Not saved yet</span>;
}

/** The single pay button; stays off while a section has unsaved changes or `reason` says why. */
export function PayButton({ reason, children }: { reason: string | null; children: ReactNode }) {
  const ctx = useContext(GuardContext);
  const { pending } = useFormStatus();
  const unsaved = Object.values(ctx?.dirty ?? {});
  const note = unsaved.length ? `Save your changes in ${unsaved.join(" and ")} first.` : reason;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <SubmitButton disabled={pending || !!note}>{children}</SubmitButton>
      </div>
      {note && <p className="text-xs text-ink-faint">{note}</p>}
    </>
  );
}
