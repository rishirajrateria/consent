/* The owner's written condition on an approval. It narrows how the content
   may be used (credit on screen, no political use…). It can never ask for
   money: the consent request fee, paid before the request was sent, is the
   only payment. Pure, so it can be tested and used in the browser too. */

/** Longest written condition, in characters. */
export const CONDITION_MAX = 300;

/** What the condition field says under it. */
export const CONDITION_HINT = `Optional, up to ${CONDITION_MAX} characters. It can't ask for money: the consent request fee is the only payment.`;

// A sum of money ("₹500", "$ 20", "500 rupees", "INR 500", "20k USD", "500/-"),
// a word that asks for one, a share of what the content earns, or a way to
// send money. Conditions that narrow where it runs stay allowed: "Not for
// paid ads", "No pay-per-view channels", "Use at most 50% of the clip",
// "Don't transfer this consent to anyone else".
const MONEY = [
  /[₹$€£¥]\s*\d/,
  /\d\s*(?:k\s*)?(?:₹|\$|€|£|rs\.?|inr|usd|eur|gbp|aed|sgd|cad|aud|rupees?|dollars?|euros?|pounds?|bucks)\b/i,
  /\b(?:rs\.?|inr|usd|eur|gbp|aed|sgd|cad|aud)\s*\d/i,
  /\d\s*\/-/,
  /\b(?:fees?|payments?|pay\s+(?:me|us|my|our)|invoices?|royalt(?:y|ies)|compensation|remuneration|honorarium|licen[cs]e\s+fee|revenue\s+share|commission|upfront)\b/i,
  /\b(?:money|cash|funds|deposit|proceeds|kickback)\b/i,
  // "pay", "pays", "paying"; not "paid ads" or "pay-per-view".
  /\bpay(?:s|ing)?\b(?!-)/i,
  /\b(?:agreed|extra|additional|full|total)\s+(?:amount|sum|price|rate)\b/i,
  /\b(?:revenue|profits?|earnings|income)\b/i,
  /\d+\s*(?:%|percent|per\s+cent)\s+of\s+(?:the\s+)?(?:\w+\s+)?(?:sales|proceeds|takings)\b/i,
  /\b(?:a|my|our)\s+cut\b/i,
  /\b(?:upi|paypal|g\s?pay|google\s+pay|paytm|phonepe|venmo|neft|imps|rtgs|iban)\b/i,
  /\bbank\s+(?:account|transfer|details?)\b/i,
  /\b(?:wire|transfer|send)\s+(?:me\s+|us\s+)?\d/i,
];

/** Why a written condition can't be used, or null when it is fine (or empty). */
export function conditionProblem(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > CONDITION_MAX) return `Keep the written condition under ${CONDITION_MAX} characters.`;
  if (MONEY.some((re) => re.test(text)))
    return "A condition can't ask for money. The consent request fee is the only payment. Remove the money part, or decline.";
  return null;
}
