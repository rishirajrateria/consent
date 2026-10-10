import { Alert } from "@/components/ui";

/** How a module key reads on the roles page. */
const LABEL: Record<string, string> = { consenters: "profiles (ID checks)", cms: "pages & messages" };
const label = (module: string) => LABEL[module] ?? module;

/**
 * Shown in place of an action form when the admin's role can only view it,
 * so nobody types a decision that the server will refuse.
 */
export function NoPermission({ to, perm, module }: { to: string; perm: string; module: string }) {
  return (
    <p className="border-t hairline pt-3 text-xs text-ink-faint">
      You can view this. To {to}, your role needs &ldquo;{perm}&rdquo; on {label(module)}. Ask a Super Admin.
    </p>
  );
}

/** Page-level version for settings pages full of forms: said before anything is typed. */
export function ViewOnlyPage({ module }: { module: string }) {
  return (
    <Alert>
      You can view this page. To save changes, your role needs &ldquo;edit&rdquo; on {label(module)}. Ask a Super Admin.
    </Alert>
  );
}
