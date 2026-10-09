import { requireConsenter } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Card, Field, Input, SectionTitle, EmptyState } from "@/components/ui";
import { SubmitButton, ConfirmSubmit } from "@/components/form";
import { ErrorNote, SuccessNote } from "@/components/error-note";
import { addListEntryAction, removeListEntryAction } from "../rules/actions";
import { Ban, Star } from "lucide-react";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Blacklist & whitelist" };

export default async function ListsPage({ searchParams }: PageProps<"/c-panel/lists">) {
  const sp = await searchParams;
  const { consenter } = await requireConsenter();
  const entries = await db.listEntry.findMany({
    where: { consenterId: consenter.id },
    include: { requester: true },
    orderBy: { createdAt: "desc" },
  });
  const blacklist = entries.filter((e) => e.kind === "BLACKLIST");
  const whitelist = entries.filter((e) => e.kind === "WHITELIST");

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={consenter.displayName}
        title="Blacklist & whitelist"
        desc="Blocked requesters can't send you requests. Whitelisted requesters can be used as a standing-rule condition."
      />
      <ErrorNote error={sp.error as string | undefined} />
      {sp.saved && <SuccessNote msg="List updated." />}

      <div className="grid gap-4 lg:grid-cols-2">
        {([
          ["BLACKLIST", "Blacklist", Ban, blacklist, "They see “This profile is not accepting requests from you”."],
          ["WHITELIST", "Whitelist", Star, whitelist, "Trusted requesters — e.g. auto-approve them with a rule."],
        ] as const).map(([kind, title, Icon, list, desc]) => (
          <Card key={kind} className="space-y-4">
            <SectionTitle title={title} desc={desc} />
            <form action={addListEntryAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="kind" value={kind} />
              <div className="min-w-40 flex-1">
                <Field label="Requester name or handle" required>
                  <Input name="requester" required placeholder="Acme Clips" />
                </Field>
              </div>
              <div className="min-w-32 flex-1">
                <Field label="Note">
                  <Input name="note" placeholder="optional" />
                </Field>
              </div>
              <SubmitButton variant="secondary" size="sm">
                <Icon className="size-3.5" aria-hidden /> Add
              </SubmitButton>
            </form>
            {list.length === 0 ? (
              <EmptyState icon={Icon} title={`${title} is empty`} />
            ) : (
              <div className="divide-y divide-ink/5">
                {list.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{e.requester.displayName}</div>
                      <div className="text-xs text-ink-faint">
                        {e.note ? `${e.note} · ` : ""}added {fmtDate(e.createdAt)}
                      </div>
                    </div>
                    <form action={removeListEntryAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <ConfirmSubmit confirm={`Remove ${e.requester.displayName} from the ${title.toLowerCase()}?`} variant="ghost" size="sm">
                        Remove
                      </ConfirmSubmit>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
