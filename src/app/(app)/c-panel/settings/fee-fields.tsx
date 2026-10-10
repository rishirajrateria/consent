"use client";

import { useState, type ReactNode } from "react";
import { Field, Input, Select } from "@/components/ui";
import { fmtMoney } from "@/lib/utils";
import { platformFeeFor, PLATFORM_PCT } from "@/lib/platform-fee";
import { atLeast, type FeeMode, type TierMode } from "./fee-form";

type CurrencyOption = { code: string; name: string; minConsentFee: number };

/** One pill in a Free / A fee choice. */
function Choice({ name, value, checked, onPick, children }: { name: string; value: string; checked: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <label className="relative inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-ink/10 bg-white/60 px-3.5 py-2 text-sm font-medium text-ink-soft transition-all hover:bg-white hover:text-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-ink/10">
      <input type="radio" name={name} value={value} required checked={checked} onChange={onPick} className="sr-only" />
      {children}
    </label>
  );
}

/**
 * The consent request fee fields: Free or a fee (at least the currency's
 * minimum, shown as you pick the currency), and a fee per kind of consent.
 * Field names match readFeeForm.
 */
export function FeeFields({
  currencies,
  initial,
  intents,
}: {
  currencies: CurrencyOption[];
  initial: { mode: FeeMode; amount: string; currency: string };
  intents: { id: string; name: string; mode: TierMode; amount: string }[];
}) {
  const [mode, setMode] = useState<FeeMode>(initial.mode);
  const [amount, setAmount] = useState(initial.amount);
  const [code, setCode] = useState(initial.currency);
  const [tierModes, setTierModes] = useState(() => Object.fromEntries(intents.map((i) => [i.id, i.mode])));
  const currency = currencies.find((c) => c.code === code) ?? currencies[0];
  const min = currency?.minConsentFee ?? 0;
  const fee = Number(amount);
  const validFee = mode === "paid" && amount !== "" && fee >= min;
  const money = (n: number) => fmtMoney(n, code);

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-wider text-ink-soft">Consent request fee</legend>
        <div className="flex flex-wrap gap-2">
          <Choice name="feeMode" value="free" checked={mode === "free"} onPick={() => setMode("free")}>
            Free
          </Choice>
          <Choice name="feeMode" value="paid" checked={mode === "paid"} onPick={() => setMode("paid")}>
            A fee
          </Choice>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "paid" && (
          <Field label="Your fee" hint={currency ? atLeast(currency) : undefined}>
            <Input
              name="consentPrice"
              type="number"
              inputMode="decimal"
              min={min}
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(min)}
            />
          </Field>
        )}
        <Field label="Currency" hint={mode === "free" && currency ? `${atLeast(currency)} for a paid fee.` : undefined}>
          <Select name="consentPriceCurrency" value={code} onChange={(e) => setCode(e.target.value)} required>
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-sm text-ink-soft" aria-live="polite">
        {mode === "free"
          ? "Anyone verified can ask you without paying, and there's no platform fee."
          : validFee
            ? `People who ask pay ${money(fee + platformFeeFor(fee))}: your ${money(fee)} fee plus a ${PLATFORM_PCT} platform fee of ${money(platformFeeFor(fee))} (and tax on the platform fee where it applies).`
            : `People who ask pay your fee plus a ${PLATFORM_PCT} platform fee on top.`}
      </p>

      <div id="fees-by-use" className="scroll-mt-24 space-y-2 border-t hairline pt-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Different fees for different kinds of consent
        </div>
        <p className="text-xs text-ink-faint">
          Charge differently by why they&apos;re asking, like News free and Promotion at a higher fee. Each one is
          your fee, free, or {currency ? `at least ${fmtMoney(currency.minConsentFee, currency.code)}` : "at least the minimum"}.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {intents.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-2">
              <span className="w-28 shrink-0 truncate text-xs text-ink-soft">{i.name}</span>
              <Select
                name={`tierMode_${i.id}`}
                value={tierModes[i.id]}
                onChange={(e) => setTierModes((m) => ({ ...m, [i.id]: e.target.value as TierMode }))}
                className="w-32 py-1.5 text-xs"
                aria-label={`Consent request fee for ${i.name}`}
              >
                <option value="base">Your fee</option>
                <option value="free">Free</option>
                <option value="paid">A fee</option>
              </Select>
              {tierModes[i.id] === "paid" && (
                <Input
                  name={`tier_${i.id}`}
                  type="number"
                  inputMode="decimal"
                  min={min}
                  step="0.01"
                  required
                  defaultValue={i.amount}
                  placeholder={String(min)}
                  className="w-28 py-1.5 text-xs"
                  aria-label={`Fee for ${i.name}`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
