import "server-only";
import { db } from "./db";
import { consumeOtp } from "./auth";

/**
 * Pluggable e-signature provider interface (§8.5). The in-app provider signs
 * with typed name + email OTP + timestamp + IP. DocuSign (global) and
 * Leegality/Digio Aadhaar eSign (India) implement this same interface; the
 * active provider is chosen in admin → System settings.
 */
export interface ESignProvider {
  name: string;
  /** Verifies the signer's identity for this signature attempt. */
  verifySigner(opts: { userId: string; otpCode: string }): Promise<boolean>;
}

class InAppESign implements ESignProvider {
  name = "in-app";
  async verifySigner({ userId, otpCode }: { userId: string; otpCode: string }) {
    return consumeOtp(userId, "SIGNATURE", otpCode);
  }
}

const PROVIDERS: Record<string, () => ESignProvider> = {
  "in-app": () => new InAppESign(),
  // docusign: () => new DocuSignESign(),      // plug in with DOCUSIGN_* env keys
  // leegality: () => new LeegalityESign(),    // plug in with LEEGALITY_* env keys
};

export async function getESignProvider(): Promise<ESignProvider> {
  const row = await db.setting.findUnique({ where: { key: "esign_provider" } }).catch(() => null);
  const name = (row?.value as string) || "in-app";
  return (PROVIDERS[name] ?? PROVIDERS["in-app"])();
}
