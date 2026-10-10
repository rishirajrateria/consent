"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Card, Field, Input, Textarea, Select, Alert } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { ErrorNote } from "@/components/error-note";
import { COUNTRIES } from "@/lib/countries";
import { requesterTypeFor } from "@/lib/profiles-pure";
import { currencyForCountry, type CurrencyRule } from "@/lib/currency-rules";
import { PLATFORM_PCT } from "@/lib/platform-fee";
import { atLeast } from "../c-panel/settings/fee-form";
import { MAX_LIMIT } from "../c-panel/settings/limits";
import type { ConsenterEntityType } from "@prisma/client";
import { submitProfileApplicationAction } from "./actions";
import {
  CREATOR_TYPES,
  DOCUMENT_TYPES,
  ENTITY_TYPES,
  LIMIT_KINDS,
  MAX_CHANNELS,
  MIN_BIO,
  type ApplicationState,
  type ApplicationValues,
} from "./application";

const FILE_INPUT =
  "file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white";

const SECTION = "text-sm font-semibold uppercase tracking-wider text-ink-soft";

const creatorFor = (kind: string) => (kind ? requesterTypeFor(kind as ConsenterEntityType) : "");

/**
 * Kind of profile and creator type. The creator type follows the kind until
 * the person picks one themselves.
 */
function KindFields({ kind: initialKind, creator: initialCreator }: { kind: string; creator: string }) {
  const [kind, setKind] = useState(initialKind);
  const [creator, setCreator] = useState(initialCreator || creatorFor(initialKind));
  const [picked, setPicked] = useState(!!initialCreator && initialCreator !== creatorFor(initialKind));
  return (
    <>
      <Field label="Kind of profile" required hint="A person, or a brand, show or team you represent.">
        <Select
          name="entityType"
          required
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            if (!picked) setCreator(creatorFor(e.target.value));
          }}
        >
          <option value="" disabled>
            Choose
          </option>
          {ENTITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Creator type" required hint="What you make when you ask others. People can use it in their rules.">
        <Select
          name="creatorType"
          required
          value={creator}
          onChange={(e) => {
            setCreator(e.target.value);
            setPicked(true);
          }}
        >
          <option value="" disabled>
            Choose
          </option>
          {CREATOR_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

/** One pill in a set of required radios. Nothing is picked until the person picks. */
function Choice({
  name,
  value,
  checked,
  onPick,
  children,
}: {
  name: string;
  value: string;
  checked: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <label className="relative inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-ink/10 bg-white/60 px-3.5 py-2 text-sm font-medium text-ink-soft transition-all hover:bg-white hover:text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ink/10">
      <input type="radio" name={name} value={value} required checked={checked} onChange={onPick} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * The consent request fee: its currency (following the country until the
 * person picks one), then Free or a fee of at least that currency's minimum.
 * Field names match readFeeForm.
 */
function FeeCard({ currencies, country, v }: { currencies: CurrencyRule[]; country: string; v: ApplicationValues }) {
  const [picked, setPicked] = useState(v.consentPriceCurrency);
  const [mode, setMode] = useState(v.feeMode);
  const has = (code: string) => currencies.some((c) => c.code === code);
  const code = picked && has(picked) ? picked : has(currencyForCountry(country)) ? currencyForCountry(country) : (currencies[0]?.code ?? "");
  const currency = currencies.find((c) => c.code === code);
  const min = currency?.minConsentFee ?? 0;
  return (
    <Card className="space-y-4">
      <div>
        <h2 className={SECTION}>Your consent request fee</h2>
        <p className="mt-1 text-xs text-ink-faint">
          What people pay to ask you. You can make it free. You can set different fees for different kinds of consent
          later.
        </p>
      </div>
      <Field label="Currency" required>
        <Select name="consentPriceCurrency" required value={code} onChange={(e) => setPicked(e.target.value)}>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} · {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
          Consent request fee
          <span className="ml-0.5 text-ink">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          <Choice name="feeMode" value="free" checked={mode === "free"} onPick={() => setMode("free")}>
            Free
          </Choice>
          <Choice name="feeMode" value="paid" checked={mode === "paid"} onPick={() => setMode("paid")}>
            A fee
          </Choice>
        </div>
      </fieldset>
      {mode === "paid" && (
        <Field label="Your fee" required hint={currency ? atLeast(currency) : undefined}>
          <Input
            name="consentPrice"
            type="number"
            inputMode="decimal"
            required
            min={min}
            step="0.01"
            defaultValue={v.consentPrice}
            placeholder={String(min)}
          />
        </Field>
      )}
      {mode && (
        <p className="text-sm text-ink-soft" aria-live="polite">
          {mode === "free"
            ? "Anyone verified can ask you without paying."
            : `People who ask pay your fee plus a ${PLATFORM_PCT} platform fee on top.`}
        </p>
      )}
    </Card>
  );
}

/** How many requests the profile can receive: Unlimited, or a number per day, week or month. */
function LimitCard({ v }: { v: ApplicationValues }) {
  const [kind, setKind] = useState(v.limitKind);
  const per = LIMIT_KINDS.find((k) => k.value === kind);
  return (
    <Card className="space-y-4">
      <div>
        <h2 className={SECTION}>Requests you can receive</h2>
        <p className="mt-1 text-xs text-ink-faint">When you reach the limit, new requests pause. They resume as you answer.</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">
          How many
          <span className="ml-0.5 text-ink">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {LIMIT_KINDS.map((k) => (
            <Choice key={k.value} name="limitKind" value={k.value} checked={kind === k.value} onPick={() => setKind(k.value)}>
              {k.label}
            </Choice>
          ))}
        </div>
      </fieldset>
      {per && per.value !== "unlimited" && (
        <Field label={`Requests ${per.label.toLowerCase()}`} required hint="A whole number, 1 or more.">
          <Input
            name="limitCount"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={MAX_LIMIT}
            step={1}
            defaultValue={v.limitCount}
            placeholder="20"
          />
        </Field>
      )}
    </Card>
  );
}

function ChannelRow({ i, value }: { i: number; value?: ApplicationValues["channels"][number] }) {
  const first = i === 0;
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_2fr_7rem]">
      <Input
        name="channelPlatform"
        required={first}
        maxLength={40}
        placeholder="YouTube"
        aria-label={`Channel ${i + 1} platform`}
        defaultValue={value?.platform}
      />
      <Input
        name="channelUrl"
        required={first}
        inputMode="url"
        autoComplete="url"
        maxLength={500}
        placeholder="https://youtube.com/@you"
        aria-label={`Channel ${i + 1} link`}
        defaultValue={value?.url}
      />
      <Input
        name="channelFollowers"
        type="number"
        required={first}
        min={0}
        step={1}
        inputMode="numeric"
        placeholder="Followers"
        aria-label={`Channel ${i + 1} followers`}
        defaultValue={value?.followers}
      />
    </div>
  );
}

/**
 * The one onboarding form. Every field is required except "Also known as".
 * On a problem the server answers with the message and what was typed, and
 * the form comes back filled in (files have to be added again).
 */
export function ApplicationForm({
  initial,
  reapplyId,
  currencies,
}: {
  initial: ApplicationValues;
  reapplyId?: string;
  currencies: CurrencyRule[];
}) {
  const [state, formAction] = useActionState(submitProfileApplicationAction, {
    error: null,
    values: initial,
    attempt: 0,
  } satisfies ApplicationState);

  return (
    <form key={state.attempt} action={formAction} className="space-y-5">
      {reapplyId && <input type="hidden" name="reapplyId" value={reapplyId} />}
      <ApplicationFields v={state.values} error={state.error} currencies={currencies} />
    </form>
  );
}

/** The form's cards. Remounted with the form on every answer from the server. */
function ApplicationFields({
  v,
  error,
  currencies,
}: {
  v: ApplicationValues;
  error: string | null;
  currencies: CurrencyRule[];
}) {
  // The fee currency follows the country until the person picks one.
  const [country, setCountry] = useState(v.country);
  const extraOpen = v.channels.slice(3).some((c) => c.platform || c.url || c.followers);

  return (
    <>
      <Card className="space-y-4">
        <h2 className={SECTION}>Who this profile is</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <KindFields kind={v.entityType} creator={v.creatorType} />
          <Field label="Country" required>
            <Select name="country" required value={country} onChange={(e) => setCountry(e.target.value)}>
              <option value="" disabled>
                Choose
              </option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Legal name" required hint="As on the ID document, or the registered name.">
            <Input name="legalName" required minLength={2} maxLength={200} autoComplete="name" defaultValue={v.legalName} placeholder="Jane Carter" />
          </Field>
          <Field label="Public display name" required hint="The name people see and search for.">
            <Input name="displayName" required minLength={2} maxLength={100} defaultValue={v.displayName} placeholder="Jane Carter" />
          </Field>
          <Field label="Also known as" hint="Optional. Nicknames or other names, separated by commas.">
            <Input name="aliases" maxLength={500} defaultValue={v.aliases} placeholder="JC, janecarterofficial" />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className={SECTION}>What you do</h2>
        <Field label="What you do" required hint="Shown on your profile and used in search.">
          <Input name="category" required minLength={2} maxLength={100} defaultValue={v.category} placeholder="Actor, news channel, clothing brand…" />
        </Field>
        <Field label="About you" required hint={`At least ${MIN_BIO} characters. Shown on your public profile.`}>
          <Textarea
            name="bio"
            required
            minLength={MIN_BIO}
            maxLength={2000}
            defaultValue={v.bio}
            placeholder="Who you are and what you're known for."
          />
        </Field>
        <Field label="Profile photo" required hint="An image. Shown on your public profile.">
          <Input name="photo" type="file" required accept="image/*" className={FILE_INPUT} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className={SECTION}>Your channels</h2>
          <p className="mt-1 text-xs text-ink-faint">
            At least one, up to {MAX_CHANNELS}. Paste the full link and the follower count. People tap these to
            see who you are.
          </p>
        </div>
        {[0, 1, 2].map((i) => (
          <ChannelRow key={i} i={i} value={v.channels[i]} />
        ))}
        <details open={extraOpen} className="glass-subtle px-4 py-3">
          <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium">Add more channels</summary>
          <div className="mt-3 space-y-4">
            {Array.from({ length: MAX_CHANNELS - 3 }, (_, k) => k + 3).map((i) => (
              <ChannelRow key={i} i={i} value={v.channels[i]} />
            ))}
          </div>
        </details>
      </Card>

      <FeeCard currencies={currencies} country={country} v={v} />
      <LimitCard v={v} />

      <Card className="space-y-4">
        <h2 className={SECTION}>ID check</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID document type" required>
            <Select name="documentType" required defaultValue={v.documentType}>
              <option value="" disabled>
                Choose
              </option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ID document number" required hint="Kept only as a fingerprint, to stop duplicate profiles.">
            <Input name="documentNumber" required minLength={3} maxLength={100} defaultValue={v.documentNumber} placeholder="Passport or registration number" />
          </Field>
        </div>
        <Field
          label="ID document file"
          required
          hint="A PDF or an image. People: a government ID. Brands and shows: a registration or trademark document, or a letter that lets you represent the name. Only the review team sees it."
        >
          <Input name="document" type="file" required accept="image/*,.pdf" className={FILE_INPUT} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <label className="flex min-h-10 items-start gap-3 text-sm">
          <input type="checkbox" name="declaration" required className="mt-0.5 size-4 shrink-0 accent-black" />
          <span>This is me, or I am authorised to represent this name.</span>
        </label>
        {error && (
          <>
            <ErrorNote error={error} />
            <Alert>Add your profile photo and ID document again before you send.</Alert>
          </>
        )}
        <SubmitButton className="w-full">Send for ID check</SubmitButton>
      </Card>
    </>
  );
}
