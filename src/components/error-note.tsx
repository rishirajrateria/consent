import { AlertTriangle, CheckCircle2 } from "lucide-react";

export function ErrorNote({ error }: { error?: string | string[] }) {
  if (!error) return null;
  const msg = Array.isArray(error) ? error[0] : error;
  return (
    <div
      role="alert"
      className="glass-subtle flex items-start gap-2 border-ink/20 px-3.5 py-2.5 text-sm text-ink"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {msg}
    </div>
  );
}

export function SuccessNote({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <div role="status" className="glass-subtle flex items-start gap-2 px-3.5 py-2.5 text-sm text-ink-soft">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      {msg}
    </div>
  );
}
