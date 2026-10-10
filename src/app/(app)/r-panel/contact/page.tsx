import { requireRequester } from "@/lib/auth";
import { PageHeader, Card, Field, Input, Textarea, SectionTitle } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { ViewOnlyNote } from "@/components/request-view";
import { saveRequesterContactAction } from "./actions";

export const metadata = { title: "Contact details" };

export default async function RequesterContactPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { requester, member } = await requireRequester();
  const canEdit = member.role === "OWNER";
  const rows: { name: string; share: string; label: string; shareLabel: string; value: string | null; on: boolean }[] = [
    { name: "contactEmail", share: "shareEmail", label: "Email", shareLabel: "Share my email", value: requester.contactEmail, on: requester.shareEmail },
    { name: "contactPhone", share: "sharePhone", label: "Phone", shareLabel: "Share my phone", value: requester.contactPhone, on: requester.sharePhone },
    { name: "contactAddress", share: "shareAddress", label: "Address", shareLabel: "Share my address", value: requester.contactAddress, on: requester.shareAddress },
    { name: "managerContact", share: "shareManager", label: "Manager/agency", shareLabel: "Share my manager/agency", value: requester.managerContact, on: requester.shareManager },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        kicker={requester.displayName}
        title="Contact details"
        desc="What an owner sees when they share their contact details with you on a request."
      />
      <ErrorNote error={sp.error} />
      {sp.saved && <SuccessNote msg="Contact details saved." />}

      <form action={saveRequesterContactAction}>
        <fieldset disabled={!canEdit} className="min-w-0">
          <Card className="space-y-5">
            <SectionTitle
              title="Contact details you share"
              desc="Nothing is shared until an owner shares theirs with you. Then they see only the details you switch on here."
            />
            {rows.map((r) => (
              <div key={r.name} className="space-y-2">
                <Field label={r.label}>
                  {r.name === "contactAddress" ? (
                    <Textarea name={r.name} defaultValue={r.value ?? ""} maxLength={500} className="min-h-20" />
                  ) : (
                    <Input
                      name={r.name}
                      type={r.name === "contactEmail" ? "email" : r.name === "contactPhone" ? "tel" : "text"}
                      defaultValue={r.value ?? ""}
                    />
                  )}
                </Field>
                <label className="flex min-h-10 items-center gap-3 text-sm">
                  <input type="checkbox" name={r.share} defaultChecked={r.on} className="size-4 accent-black" />
                  {r.shareLabel}
                </label>
              </div>
            ))}
            {canEdit ? (
              <SubmitButton>Save contact details</SubmitButton>
            ) : (
              <ViewOnlyNote>Only the account owner can change these.</ViewOnlyNote>
            )}
          </Card>
        </fieldset>
      </form>
    </div>
  );
}
