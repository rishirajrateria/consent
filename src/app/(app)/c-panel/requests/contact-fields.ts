/* Which of the owner's contact details they can share on a request. Each one
   shows its actual value; a detail with no value can't be picked until it's
   added in settings. The ticks start from the profile's share switches.
   Server-only: the values come from the same helpers revealContacts uses. */

import { CONTACT_FIELDS, contactCard, defaultContactFields, type ContactField } from "@/lib/requests";

type ContactProfile = Parameters<typeof contactCard>[0];

export type ContactChoice = {
  field: ContactField;
  label: string;
  /** The detail as it would be shared; null when the profile has none. */
  value: string | null;
  /** Ticked to start with: the profile shares it and it has a value. */
  defaultOn: boolean;
};

const LABEL: Record<ContactField, string> = {
  email: "Email",
  phone: "Phone",
  address: "Address",
  manager: "Manager/agency",
};

export function contactChoices(p: ContactProfile): ContactChoice[] {
  const values = contactCard(p, CONTACT_FIELDS);
  const on = new Set(defaultContactFields(p));
  return CONTACT_FIELDS.map((field) => ({
    field,
    label: LABEL[field],
    value: values[field],
    defaultOn: !!values[field] && on.has(field),
  }));
}

/** The ticked details from a form ("shareField"), keeping only ones that have a value. */
export function pickedContactFields(formData: FormData, p: ContactProfile): ContactField[] {
  const picked = new Set(formData.getAll("shareField").map(String));
  return contactChoices(p)
    .filter((c) => c.value && picked.has(c.field))
    .map((c) => c.field);
}
