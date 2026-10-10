import { expect, type Browser, type Page, type APIRequestContext } from "@playwright/test";
import { authenticator } from "otplib";
import fs from "fs";
import path from "path";
import { db } from "./db";

export const PASSWORD = "Password1!";

export const TOTP_SECRET_FILE = path.join(__dirname, ".totp-secret.json");

export const AUTH_DIR = path.join(__dirname, ".auth");

export const PERSONAS = {
  admin: { email: "admin@consent.app", totp: true },
  jane: { email: "jane@demo.consent", totp: true },
  show: { email: "show@demo.consent", totp: true },
  clips: { email: "clips@demo.consent", totp: false },
  news: { email: "news@demo.consent", totp: false },
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

/** Logs a persona in via the UI, completing /2fa when TOTP is enabled. */
export async function login(page: Page, email: string, opts: { totp?: boolean } = {}) {
  await visit(page, "/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (opts.totp) {
    await page.waitForURL(/\/2fa/);
    const secret = loadTotpSecret();
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.fill('input[name="code"]', await totpCode(secret));
      await page.getByRole("button", { name: "Verify" }).click();
      try {
        await page.waitForURL(/\/dashboard/, { timeout: 7000 });
        break;
      } catch {
        // invalid/expired code — the page is back on /2fa with an error; retry
      }
    }
  }
  await page.waitForURL(/\/dashboard/);
}

/** New page in a context restored from the persona's saved storage state. */
export async function pageFor(browser: Browser, persona: PersonaKey): Promise<Page> {
  const ctx = await browser.newContext({ storageState: authFile(persona) });
  return ctx.newPage();
}

/** Runs all background sweeps (SLA expiry, settlements, …) once. */
export async function runJobs(request: APIRequestContext) {
  const res = await request.post("/api/jobs/tick");
  expect(res.ok(), "POST /api/jobs/tick should succeed").toBeTruthy();
}

const DEFAULT_CONTEXT =
  "E2E test content: the consenter appears prominently in a short piece produced for this automated flow.";
const DEFAULT_PLAN =
  "E2E creative plan: this automated test composes a short piece that features the consenter respectfully, explains why the material is used, covers intent in detail, and pads this text well past the minimum one hundred and twenty characters required by the platform settings.";

export type RequestSpec = {
  /** Consenter profile slug (e.g. jane-carter) used to pick the card. */
  slug: string;
  /** Search query typed into /r-panel/new. */
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
  /** Assert the mock checkout charges a single line (no consent price). */
  expectSingleCharge?: boolean;
};

async function uploadDraftFile(page: Page, kind: "ASSET" | "RAW_CONTENT" | "THUMBNAIL") {
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
}

/**
 * Drives the full request wizard: pick consenter, scope, uploads, details,
 * accept terms, pay the mock checkout. Returns the request id. Ends on the
 * request detail page (/r-panel/requests/{id}?submitted=1).
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

  // 0. pick the consenter
  await visit(page, `/r-panel/new?q=${encodeURIComponent(spec.query)}`);
  await page.locator(`form:has(input[name="consenter"][value="${spec.slug}"]) button`).click();
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
  // Intent options show the owner's price when they charge, e.g. "Commentary — $10.00".
  const intentValue = await page
    .locator('select[name="intentCategoryId"] option', { hasText: new RegExp(`^${spec.intent}( —|$)`) })
    .first()
    .getAttribute("value");
  await page.selectOption('select[name="intentCategoryId"]', intentValue!);
  await page.getByRole("button", { name: "Save details" }).click();
  await page.waitForURL(/saved=details/);

  // 4. accept terms + pay & submit
  await page.locator('input[name="acceptTerms"]').check();
  await page.getByRole("button", { name: /& submit/ }).click();
  await page.waitForURL(/\/pay\/mock\//);

  const payButton = page.getByRole("button", { name: /^Pay/ });
  await expect(payButton).toHaveCount(1);
  if (spec.expectSingleCharge) {
    await expect(payButton).not.toContainText("+");
  }
  await payButton.click();
  await page.waitForURL(new RegExp(`/r-panel/requests/${requestId}`));
  return requestId;
}
