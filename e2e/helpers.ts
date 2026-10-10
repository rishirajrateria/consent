import { expect, type Browser, type Page, type APIRequestContext } from "@playwright/test";
import { authenticator } from "otplib";
import fs from "fs";
import path from "path";
import { db } from "./db";

export const PASSWORD = "Password1!";

export const TOTP_SECRET_FILE = path.join(__dirname, ".totp-secret.json");

export const AUTH_DIR = path.join(__dirname, ".auth");

/**
 * The seeded people the specs act as. Every account has 2FA now (every
 * account can answer consent requests), so every persona signs in with TOTP.
 * Each one except the admin runs one profile that can both ask and be asked:
 * jane → Jane Carter, show → Nightwatch (TV series), clips → Acme Clips,
 * news → Daily Lens News.
 */
export const PERSONAS = {
  admin: { email: "admin@consent.app" },
  jane: { email: "jane@demo.consent" },
  show: { email: "show@demo.consent" },
  clips: { email: "clips@demo.consent" },
  news: { email: "news@demo.consent" },
} as const;

export type PersonaKey = keyof typeof PERSONAS;

export function authFile(persona: PersonaKey): string {
  return path.join(AUTH_DIR, `${persona}.json`);
}

export function loadTotpSecret(): string {
  const raw = JSON.parse(fs.readFileSync(TOTP_SECRET_FILE, "utf8")) as { secret: string };
  return raw.secret;
}

/** Fresh TOTP code, waiting out the period boundary so it stays valid. */
export async function totpCode(secret: string): Promise<string> {
  if (authenticator.timeRemaining() < 4) {
    await new Promise((r) => setTimeout(r, (authenticator.timeRemaining() + 1) * 1000));
  }
  return authenticator.generate(secret);
}

/**
 * Navigate and wait for the page to settle (hydration). Interacting with a
 * server-action form before React hydrates can lose the input values, so
 * every fresh document load that is followed by form input goes through this.
 */
export async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle").catch(() => {});
}

/** Where a signed-in person lands: Home with a profile, the dashboard without one. */
const landed = (url: URL) => url.pathname === "/dashboard" || url.pathname === "/c-panel";

/** Logs a persona in via the UI, completing /2fa with the shared TOTP secret. */
export async function login(page: Page, email: string) {
  await visit(page, "/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/2fa/);
  const secret = loadTotpSecret();
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.fill('input[name="code"]', await totpCode(secret));
    await page.getByRole("button", { name: "Verify" }).click();
    try {
      await page.waitForURL(landed, { timeout: 7000 });
      break;
    } catch {
      // invalid/expired code — the page is back on /2fa with an error; retry
    }
  }
  await page.waitForURL(landed);
}

/** New page in a context restored from the persona's saved storage state. */
export async function pageFor(browser: Browser, persona: PersonaKey): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(persona) });
  return ctx.newPage();
}

/** Runs all background sweeps (window expiry, settlements, certificates…) once. */
export async function runJobs(request: APIRequestContext) {
  const secret = process.env.JOBS_SECRET;
  const res = await request.post("/api/jobs/tick", {
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
  expect(res.ok(), "POST /api/jobs/tick should succeed").toBeTruthy();
}

/** Waits for a request's status in the DB (actions redirect before the page shows it). */
export async function expectStatus(requestId: string, status: string) {
  await expect
    .poll(async () => (await db.consentRequest.findUnique({ where: { id: requestId } }))?.status, {
      message: `request ${requestId} should become ${status}`,
    })
    .toBe(status);
}

const DEFAULT_CONTEXT =
  "E2E test content: the profile asked appears prominently in a short piece produced for this automated flow.";
const DEFAULT_PLAN =
  "E2E creative plan: this automated test composes a short piece that features the profile asked respectfully, explains why the material is used, covers intent in detail, and pads this text well past the minimum one hundred and twenty characters required by the platform settings.";

export type RequestSpec = {
  /** Slug of the profile asked (e.g. jane-carter), used to pick its card on Find. */
  slug: string;
  /** Search typed into Find (/find?q=…). */
  query: string;
  formats: { platform: string; format: string; durationSec?: number }[];
  /** Asset type names, e.g. ["Name", "Photo/picture"]. */
  assetTypes: string[];
  uploadAsset?: boolean;
  uploadRaw?: boolean;
  /** Intent category option label, e.g. "News". */
  intent: string;
  context?: string;
  plan?: string;
  /**
   * What sending costs. "free": sent at once with no checkout. "paid": goes
   * through the mock checkout. Left out, either is accepted.
   */
  charge?: "free" | "paid";
  /** For a paid ask: the exact total on the Pay button, e.g. "$120.00". */
  expectTotal?: string;
};

export async function uploadDraftFile(page: Page, kind: "ASSET" | "RAW_CONTENT" | "THUMBNAIL"): Promise<string> {
  const name = `e2e-${kind.toLowerCase()}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`;
  const form = page.locator(`form:has(input[name="kind"][value="${kind}"])`);
  await form.locator('input[name="file"]').setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(`E2E ${kind} payload ${name}`),
  });
  await form.locator('button[type="submit"]').click();
  // the page re-renders with the uploaded file listed (in Uploads and again in the review summary)
  await expect(page.getByText(name).first()).toBeVisible();
  return name;
}

/** The single send button in step 4: "Pay $X & send" for a paid ask, "Send request" for a free one. */
export function sendButton(page: Page) {
  return page.getByRole("button", { name: /& send$|^Send request$/ });
}

/**
 * Asks someone from start to finish: Find (/find?q=) → "Ask for permission"
 * → the draft editor (scope, uploads, details, terms) → send. A free ask is
 * sent at once and lands on /r-panel/requests/{id}; a paid one goes through
 * /pay/mock first. Returns the request id.
 */
export async function submitBasicRequest(page: Page, spec: RequestSpec): Promise<string> {
  // Resolve catalog ids directly from the DB for deterministic selectors.
  const platformNames = [...new Set(spec.formats.map((f) => f.platform))];
  const platforms = await db.platform.findMany({
    where: { name: { in: platformNames } },
    include: { formats: true },
  });
  const fmts = spec.formats.map((f) => {
    const p = platforms.find((x) => x.name === f.platform);
    const fm = p?.formats.find((x) => x.name === f.format);
    if (!fm) throw new Error(`Format ${f.platform} → ${f.format} not found`);
    return { id: fm.id, durationSec: f.durationSec };
  });
  const assets = await db.assetType.findMany({ where: { name: { in: spec.assetTypes } } });
  if (assets.length !== spec.assetTypes.length) throw new Error("Asset type lookup failed");

  // 0. find them and ask (opens a new draft, or the one already started for them)
  await visit(page, `/find?q=${encodeURIComponent(spec.query)}`);
  await page.locator(`form:has(input[name="consenter"][value="${spec.slug}"])`).getByRole("button").click();
  await page.waitForURL(/\/r-panel\/requests\/[^/?#]+\/edit/);
  await page.waitForLoadState("networkidle").catch(() => {});
  const requestId = page.url().match(/requests\/([^/?#]+)\/edit/)![1];

  // 1. scope
  for (const f of fmts) {
    await page.locator(`input[name="formatIds"][value="${f.id}"]`).check();
    if (f.durationSec) await page.fill(`input[name="duration_${f.id}"]`, String(f.durationSec));
  }
  for (const a of assets) {
    await page.locator(`input[name="assetTypeIds"][value="${a.id}"]`).check();
  }
  await page.getByRole("button", { name: "Save scope" }).click();
  await page.waitForURL(/saved=scope/);

  // 2. uploads
  if (spec.uploadAsset) await uploadDraftFile(page, "ASSET");
  if (spec.uploadRaw) await uploadDraftFile(page, "RAW_CONTENT");

  // 3. details
  await page.fill('textarea[name="context"]', spec.context ?? DEFAULT_CONTEXT);
  await page.fill('textarea[name="creativePlan"]', spec.plan ?? DEFAULT_PLAN);
  // Intent options can carry the fee, e.g. "Review — $100.00 consent request fee" or "News — free to ask".
  const intentValue = await page
    .locator('select[name="intentCategoryId"] option', { hasText: new RegExp(`^${spec.intent}( —|$)`) })
    .first()
    .getAttribute("value");
  await page.selectOption('select[name="intentCategoryId"]', intentValue!);
  await page.getByRole("button", { name: "Save details" }).click();
  await page.waitForURL(/saved=details/);

  // 4. accept the terms and send ("Send request" when free, "Pay … & send" when paid)
  await page.locator('input[name="acceptTerms"]').check();
  const send = sendButton(page);
  await expect(send).toBeEnabled();
  if (spec.charge === "free") await expect(send).toHaveText(/^Send request$/);
  if (spec.charge === "paid") await expect(send).toHaveText(/^Pay .+ & send$/);
  await send.click();

  const sentPath = `/r-panel/requests/${requestId}`;
  await page.waitForURL((url) => url.pathname === sentPath || url.pathname.startsWith("/pay/mock/"));
  if (new URL(page.url()).pathname.startsWith("/pay/mock/")) {
    expect(spec.charge, "a free ask must not open a checkout").not.toBe("free");
    const payButton = page.getByRole("button", { name: /^Pay/ });
    await expect(payButton).toHaveCount(1);
    if (spec.expectTotal) await expect(payButton).toHaveText(`Pay ${spec.expectTotal}`);
    await payButton.click();
    await page.waitForURL((url) => url.pathname === sentPath);
  } else {
    expect(spec.charge, "a paid ask must go through checkout").not.toBe("paid");
  }
  await expect(page.getByText(/^Request sent\./).first()).toBeVisible();
  return requestId;
}
