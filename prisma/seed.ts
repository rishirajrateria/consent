/* Seed: catalog data, pricing, templates, admin roles + demo accounts.
   Run: npm run db:seed */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const PLATFORMS: Record<string, { formats: [string, boolean][] }> = {
  YouTube: { formats: [["Long video", true], ["Shorts", true], ["Community post", false], ["Live stream", true], ["Thumbnail", false]] },
  Instagram: { formats: [["Reel", true], ["Story", true], ["Feed post", false], ["Carousel", false], ["Live", true]] },
  Facebook: { formats: [["Reel", true], ["Story", true], ["Feed post", false], ["Video", true], ["Live", true]] },
  "X (Twitter)": { formats: [["Post", false], ["Video", true], ["Space", true]] },
  LinkedIn: { formats: [["Post", false], ["Video", true], ["Article", false], ["Newsletter", false]] },
  Snapchat: { formats: [["Story", true], ["Spotlight", true]] },
  TikTok: { formats: [["Video", true], ["Story", true], ["Live", true]] },
  "ShareChat / Moj": { formats: [["Video", true], ["Post", false]] },
  "Podcasts (Spotify, Apple, others)": { formats: [["Audio episode", true], ["Video episode", true], ["Episode artwork", false], ["Clip", true]] },
  "TV broadcast": { formats: [["News segment", true], ["Show segment", true], ["Promo", true]] },
  Print: { formats: [["Newspaper", false], ["Magazine", false]] },
  "News websites / blogs": { formats: [["Article", false], ["Article image", false], ["Embedded video", true]] },
  Other: { formats: [["Free-text description", false]] },
};

const ASSET_TYPES = [
  "Name", "Photo/picture", "Video reference/clip", "Voice/audio clip", "Logo/trademark",
  "Signature/catchphrase", "Character/show footage", "Poster/still", "Likeness in AI-generated content", "Other",
];

const INTENTS = ["News", "Commentary", "Parody", "Promotion", "Tribute", "Education", "Entertainment", "Review", "Documentary", "Other"];

const DENIAL_REASONS = [
  "Does not fit my brand", "Uncomfortable with the intent", "Content category not allowed",
  "Requester history concerns", "Exclusive deal elsewhere", "Legal restrictions", "Other",
];

async function main() {
  console.log("Seeding catalog…");
  let p = 0;
  for (const [name, cfg] of Object.entries(PLATFORMS)) {
    const platform = await db.platform.upsert({
      where: { name },
      update: { sortOrder: p },
      create: { name, sortOrder: p },
    });
    for (const [fname, isTimed] of cfg.formats) {
      await db.format.upsert({
        where: { platformId_name: { platformId: platform.id, name: fname } },
        update: { isTimed },
        create: { platformId: platform.id, name: fname, isTimed },
      });
    }
    p++;
  }
  for (let i = 0; i < ASSET_TYPES.length; i++) {
    await db.assetType.upsert({ where: { name: ASSET_TYPES[i] }, update: { sortOrder: i }, create: { name: ASSET_TYPES[i], sortOrder: i } });
  }
  for (const name of INTENTS) {
    await db.intentCategory.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const label of DENIAL_REASONS) {
    await db.denialReason.upsert({ where: { label }, update: {}, create: { label } });
  }

  console.log("Seeding pricing…");
  await db.priceConfig.upsert({
    where: { country: "DEFAULT" },
    update: {},
    create: { country: "DEFAULT", currency: "USD", onboardingFee: 49, yearlyFee: 99, perRequestFee: 9, taxLabel: "VAT", taxRate: 0 },
  });
  await db.priceConfig.upsert({
    where: { country: "IN" },
    update: {},
    create: { country: "IN", currency: "INR", onboardingFee: 1999, yearlyFee: 3999, perRequestFee: 299, taxLabel: "GST", taxRate: 18 },
  });

  console.log("Seeding admin roles…");
  const superRole = await db.adminRole.upsert({
    where: { name: "Super Admin" },
    update: { isSuperAdmin: true },
    create: { name: "Super Admin", isSuperAdmin: true },
  });
  const MODULES = ["requesters", "consenters", "users", "requests", "reports", "scores", "catalog", "pricing", "payments", "settings", "templates", "cms", "audit", "takedowns", "analytics"];
  const allView = Object.fromEntries(MODULES.map((m) => [m, ["view"]]));
  const roleDefs: [string, Record<string, string[]>][] = [
    ["Verification Officer", { ...allView, requesters: ["view", "edit", "approve"], consenters: ["view", "edit", "approve"] }],
    ["Support", { ...allView, users: ["view", "edit"] }],
    ["Finance", { ...allView, pricing: ["view", "create", "edit"], payments: ["view", "edit", "export"] }],
    ["Trust & Safety", { ...allView, reports: ["view", "edit", "approve"], scores: ["view", "edit"], users: ["view", "edit"], takedowns: ["view", "edit"] }],
    ["Content Moderator", { ...allView, requests: ["view", "edit"] }],
    ["Analyst", { ...allView, analytics: ["view", "export"] }],
  ];
  for (const [name, permissions] of roleDefs) {
    await db.adminRole.upsert({ where: { name }, update: { permissions }, create: { name, permissions } });
  }

  console.log("Seeding agreement template…");
  const tpl = {
    name: "Standard Likeness Licence",
    jurisdiction: "GLOBAL",
    body: `LIKENESS AND IP USAGE AGREEMENT

This agreement is made between {{consenterLegalName}} ("Consenter") and {{requesterLegalName}} ("Requester") on {{date}}.

1. GRANT. The Consenter grants the Requester permission to use the following assets: {{assetTypes}} within the following scope: {{scope}}.
2. VALIDITY. {{validity}}.
3. FEE. {{fee}}. Any fee is handled directly between the parties; Consent is not a payment intermediary.
4. FILES. This grant is bound to the exact files with SHA-256 hashes: {{fileHashes}}.
5. CONDITIONS. {{conditions}}.
6. ATTRIBUTION. The Requester must include the Consent verification link or badge in the published content.
7. REVOCATION. Revocation applies to future use only; content published within scope and validity before revocation remains covered.`,
    optionalClauses: [
      { id: "exclusivity", title: "Non-exclusivity", body: "This permission is non-exclusive; the Consenter may grant similar permissions to others." },
      { id: "credit", title: "On-screen credit", body: "The Requester will display an on-screen credit naming the Consenter." },
      { id: "noai", title: "No AI training", body: "The assets may not be used to train or fine-tune machine-learning models." },
    ],
    disclaimer:
      "Consent is not a party to this agreement and provides no legal advice. The parties are responsible for ensuring the agreement is valid and enforceable in their jurisdictions.",
  };
  const existingTpl = await db.agreementTemplate.findFirst({ where: { name: tpl.name } });
  if (existingTpl) await db.agreementTemplate.update({ where: { id: existingTpl.id }, data: tpl });
  else await db.agreementTemplate.create({ data: tpl });

  console.log("Seeding CMS pages…");
  const pages: [string, string, string][] = [
    ["pricing-note", "Pricing notes", "Consenters never pay. Requesters pay a one-time onboarding fee, a yearly subscription and a small per-request fee. No refunds on per-request fees in any outcome."],
    ["faq", "FAQ", "### Is Consent a payment platform?\nNo. If a consenter asks for a fee, you agree on the amount in the app, then settle it directly between yourselves.\n\n### What do I get after approval?\nA tamper-proof consent certificate with a public verification link, bound to the exact file hashes you uploaded.\n\n### What if someone breaks the rules?\nEither side can file a report. Upheld reports lower the offender's public Consent Score. Legal action remains between the parties — export the Consent History Dossier as evidence."],
    ["terms", "Terms of Service", "By using Consent you agree to: (1) only upload content you have rights to; (2) include the consent verification link in published content that received a grant; (3) per-request fees are non-refundable in every outcome; (4) Consent never processes payments between consenters and requesters."],
    ["privacy", "Privacy Policy", "We store UTC timestamps, hashed documents numbers and encrypted sensitive fields. You may export your data or request deletion; certificates and audit logs are retained as legally required. GDPR and India DPDP aware."],
    ["contact", "Contact", "Email support@consent.app — we answer within 2 business days."],
  ];
  for (const [slug, title, body] of pages) {
    await db.cmsPage.upsert({ where: { slug }, update: {}, create: { slug, title, body } });
  }

  console.log("Seeding demo admin…");
  const pw = await bcrypt.hash("Password1!", 10);
  await db.user.upsert({
    where: { email: "admin@consent.app" },
    update: { adminRoleId: superRole.id },
    create: {
      email: "admin@consent.app",
      phone: "+10000000001",
      name: "Ada Admin",
      passwordHash: pw,
      emailVerified: new Date(),
      phoneVerified: new Date(),
      adminRoleId: superRole.id,
      // demo TOTP secret so you can log in: add to authenticator or use the printed code
      totpEnabled: false,
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
