import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Field, Input, SectionTitle, PageHeader, KV, ButtonLink } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import {
  changePasswordAction,
  disableTotpAction,
  savePrefsAction,
  requestDeletionAction,
} from "./actions";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Account settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const sp = await searchParams;
  const session = await requireUser();
  const prefs = await db.notificationPref.findUnique({ where: { userId: session.userId } });
  const u = session.user;

  return (
    <div className="space-y-6">
      <PageHeader kicker="Account" title="Settings" desc="Login, security and notification preferences." />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.totp === "on" && <SuccessNote msg="Two-factor authentication is now enabled." />}
      {sp.pw === "changed" && <SuccessNote msg="Password updated." />}
      {sp.prefs === "saved" && <SuccessNote msg="Preferences saved." />}
      {sp.deletion === "requested" && (
        <SuccessNote msg="Deletion request recorded. Legally required records (certificates, audit logs) are retained; an admin will process the rest." />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2">
          <SectionTitle title="Identity" />
          <KV k="Name" v={u.name} />
          <KV k="Email" v={`${u.email} ${u.emailVerified ? "· verified" : "· unverified"}`} />
          <KV k="Phone" v={u.phone ? `${u.phone} ${u.phoneVerified ? "· verified" : "· unverified"}` : "—"} />
          <KV k="Member since" v={fmtDate(u.createdAt)} />
        </Card>

        <Card className="space-y-4">
          <SectionTitle
            title="Two-factor authentication"
            desc={u.totpEnabled ? "Enabled with an authenticator app." : "Mandatory for consenter teams and admins."}
          />
          {u.totpEnabled ? (
            <form action={disableTotpAction} className="flex items-end gap-2">
              <Field label="Authenticator code">
                <Input name="code" inputMode="numeric" maxLength={6} placeholder="000000" required />
              </Field>
              <ConfirmSubmit confirm="Disable two-factor authentication?" variant="danger">
                Disable
              </ConfirmSubmit>
            </form>
          ) : (
            <ButtonLink href="/settings/security" variant="secondary">
              Set up 2FA
            </ButtonLink>
          )}
        </Card>

        <Card className="space-y-4">
          <SectionTitle title="Change password" />
          <form action={changePasswordAction} className="space-y-3">
            <Field label="Current password" required>
              <Input name="current" type="password" required autoComplete="current-password" />
            </Field>
            <Field label="New password" required hint="At least 8 characters.">
              <Input name="next" type="password" required minLength={8} autoComplete="new-password" />
            </Field>
            <SubmitButton variant="secondary">Update password</SubmitButton>
          </form>
        </Card>

        <Card className="space-y-4">
          <SectionTitle title="Notifications" desc="In-app alerts are always on." />
          <form action={savePrefsAction} className="space-y-3">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="emailStateChanges"
                defaultChecked={prefs?.emailStateChanges ?? true}
                className="size-4 accent-black"
              />
              Email me on request and grant state changes
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="smsCritical"
                defaultChecked={prefs?.smsCritical ?? true}
                className="size-4 accent-black"
              />
              SMS for critical events (new requests, SLA about to expire)
            </label>
            <SubmitButton variant="secondary">Save preferences</SubmitButton>
          </form>
        </Card>

        <Card className="space-y-3 lg:col-span-2">
          <SectionTitle
            title="Privacy"
            desc="Export your data, or request account deletion (GDPR / DPDP). Certificates and audit records are retained as legally required."
          />
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/api/me/export" variant="secondary">
              Export my data (JSON)
            </ButtonLink>
            <form action={requestDeletionAction}>
              <ConfirmSubmit confirm="Request deletion of your account? This is reviewed by an admin.">
                Request account deletion
              </ConfirmSubmit>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
