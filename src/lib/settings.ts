import { db } from "./db";

export type SystemSettings = {
  slaDays: number;
  // The yearly membership. Off for now: every verified account can send for free.
  membershipFeeOn: boolean;
  takedownResponseDays: number;
  maxUploadMb: number;
  minCreativePlanChars: number;
  requesterMinScoreGate: number;
  // score weights (admin-editable)
  score: {
    base: number;
    requester: {
      perApprovedGrant: number;
      approvalRatioMax: number; // max points from ratio
      upheldReportPenalty: number;
      revocationPenalty: number;
      takedownIgnoredPenalty: number;
      changesRequestedPenalty: number;
      accountAgeMax: number;
    };
    consenter: {
      unansweredPenalty: number;
      responseRateMax: number;
      fastResponseMax: number; // bonus for low median response time
      pendingTakedownPenalty: number;
      upheldReportPenalty: number;
      profileCompletenessMax: number;
    };
  };
};

export const DEFAULT_SETTINGS: SystemSettings = {
  slaDays: 7,
  membershipFeeOn: false,
  takedownResponseDays: 7,
  maxUploadMb: 200,
  minCreativePlanChars: 120,
  requesterMinScoreGate: 200,
  score: {
    base: 500,
    requester: {
      perApprovedGrant: 10,
      approvalRatioMax: 150,
      upheldReportPenalty: 120,
      revocationPenalty: 40,
      takedownIgnoredPenalty: 80,
      changesRequestedPenalty: 5,
      accountAgeMax: 50,
    },
    consenter: {
      unansweredPenalty: 25,
      responseRateMax: 200,
      fastResponseMax: 100,
      pendingTakedownPenalty: 30,
      upheldReportPenalty: 120,
      profileCompletenessMax: 100,
    },
  },
};

export async function getSettings(): Promise<SystemSettings> {
  const row = await db.setting.findUnique({ where: { key: "system" } });
  if (!row) return DEFAULT_SETTINGS;
  const stored = row.value as Partial<SystemSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    score: {
      ...DEFAULT_SETTINGS.score,
      ...(stored.score ?? {}),
      requester: { ...DEFAULT_SETTINGS.score.requester, ...(stored.score?.requester ?? {}) },
      consenter: { ...DEFAULT_SETTINGS.score.consenter, ...(stored.score?.consenter ?? {}) },
    },
  };
}

export async function saveSettings(s: SystemSettings) {
  await db.setting.upsert({
    where: { key: "system" },
    update: { value: s },
    create: { key: "system", value: s },
  });
}
