import { defineConfig } from "@playwright/test";

/**
 * E2E suite runs against a dedicated database (consent_e2e) on port 3300.
 * Prep once with `npm run e2e:prep` (migrate + seed), then `npm run test:e2e`.
 * Chromium is preinstalled at /opt/pw-browsers/chromium in this environment.
 *
 * The "setup" project (e2e/auth.setup.ts) enables TOTP for the demo
 * consenter/admin accounts and logs each persona in once, saving storage
 * states under e2e/.auth/ so the specs never hit the login rate limit.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  retries: 1,
  workers: 1, // flows share seeded state; keep deterministic
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3300",
    launchOptions: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
      ? { executablePath: "/opt/pw-browsers/chromium" }
      : undefined,
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "chromium", testMatch: /.*\.spec\.ts/, dependencies: ["setup"] },
  ],
  webServer: {
    command:
      "DATABASE_URL=postgresql://consent:consent@localhost:5432/consent_e2e APP_URL=http://localhost:3300 STORAGE_DIR=./storage-e2e npx next start -p 3300",
    url: "http://localhost:3300/home",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
