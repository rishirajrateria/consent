import { test as setup } from "@playwright/test";
import { authenticator } from "otplib";
import fs from "fs";
import { db } from "./db";
import { AUTH_DIR, PERSONAS, TOTP_SECRET_FILE, authFile, login, type PersonaKey } from "./helpers";

/**
 * Runs once before the specs (project dependency):
 *  - gives EVERY persona the same fixed TOTP secret via Prisma (2FA is
 *    required for every account, because every account can answer consent
 *    requests; the admin panel needs it too),
 *  - logs every persona in once (rate limit: 10 logins / email / 15 min)
 *    and saves storage state files for the specs to reuse.
 */
setup("prepare TOTP + persona sessions", async ({ browser }) => {
  setup.setTimeout(240_000);

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  let secret: string;
  if (fs.existsSync(TOTP_SECRET_FILE)) {
    secret = (JSON.parse(fs.readFileSync(TOTP_SECRET_FILE, "utf8")) as { secret: string }).secret;
  } else {
    secret = authenticator.generateSecret();
    fs.writeFileSync(TOTP_SECRET_FILE, JSON.stringify({ secret }, null, 2));
  }

  for (const persona of Object.values(PERSONAS)) {
    await db.user.update({
      where: { email: persona.email },
      data: { totpEnabled: true, totpSecret: secret },
    });
  }

  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page, PERSONAS[key].email);
    await ctx.storageState({ path: authFile(key) });
    await ctx.close();
  }
});
