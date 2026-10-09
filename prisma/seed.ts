/* Seed: catalog data, pricing, templates, admin roles + demo accounts,
   plus full demo data (3 consenters incl. a TV show, 3 requesters, requests
   in every state, one issued certificate). Run: npm run db:seed */
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { storage } from "../src/lib/storage";
import { issueGrant } from "../src/lib/grants";
import { normalizeLegalName } from "../src/lib/utils";

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
    ["pricing-note", "Pricing notes", "Consenters never pay anything. Requesters pay a one-time onboarding fee, a yearly subscription and a per-request fee. Per-request fees are non-refundable in every outcome. Agreed fees between parties settle directly — money never moves through Consent."],
    ["faq", "FAQ", "### Why does this matter now?\nA voice can be cloned and a likeness generated in an afternoon, and for decades whoever hit publish set the terms. Consent reverses it: the owner writes the terms — platform by platform, use by use — and every approved use is signed, on the record, and verifiable by anyone.\n\n### Is Consent a payment platform?\nNo. Money never moves through Consent. If an owner asks for a fee, you agree on the amount in the app, then settle it directly between yourselves.\n\n### What do I get after approval?\nAn Ed25519-signed certificate bound to the SHA-256 hashes of the exact files you uploaded, with a public verification link anyone can check, forever.\n\n### What if someone breaks the rules?\nEither side can file a report. Upheld reports lower the offender's public Consent Score. Legal action stays between the parties — export the Consent History Dossier as evidence. Consent gives no legal advice."],
    ["terms", "Terms of Service", "By using Consent you agree to: (1) only upload content you have rights to; (2) include the consent verification link in published content that received a grant; (3) per-request fees are non-refundable in every outcome; (4) Consent never processes payments between consenters and requesters."],
    ["privacy", "Privacy Policy", "We store UTC timestamps, hashed document numbers and hashed document identifiers and private, access-controlled storage with short-lived signed links. You may export your data or request deletion; certificates and audit logs are retained as legally required. GDPR and India DPDP aware."],
    ["contact", "Contact", "Email support@consent.app — we answer within 2 business days."],
  ];
  for (const [slug, title, body] of pages) {
    await db.cmsPage.upsert({ where: { slug }, update: { title, body }, create: { slug, title, body } });
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

  await seedDemo();
  console.log("Seed complete.");
}

// ─────────────────────────────────────────────────────────────
// Demo data
// ─────────────────────────────────────────────────────────────

async function demoFile(opts: {
  kind: "ASSET" | "RAW_CONTENT" | "THUMBNAIL";
  name: string;
  content: string;
  requestId: string;
  uploadedById: string;
}) {
  const buf = Buffer.from(opts.content);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${opts.kind.toLowerCase()}/${sha256.slice(0, 2)}/${sha256}-${opts.name}`;
  await storage.put(key, buf);
  return db.storedFile.create({
    data: {
      kind: opts.kind,
      name: opts.name,
      mime: "text/plain",
      size: buf.length,
      sha256,
      storageKey: key,
      requestId: opts.requestId,
      uploadedById: opts.uploadedById,
    },
  });
}

async function seedDemo() {
  if (await db.user.findUnique({ where: { email: "jane@demo.consent" } })) {
    console.log("Demo data already present — skipping.");
    return;
  }
  console.log("Seeding demo data…");
  const pw = await bcrypt.hash("Password1!", 10);
  const mkUser = (email: string, name: string, phone: string) =>
    db.user.create({
      data: { email, name, phone, passwordHash: pw, emailVerified: new Date(), phoneVerified: new Date() },
    });

  const [jane, showOwner, brandOwner, clipsOwner, newsOwner, podOwner] = await Promise.all([
    mkUser("jane@demo.consent", "Jane Carter", "+15550000101"),
    mkUser("show@demo.consent", "Nina Producer", "+15550000102"),
    mkUser("brand@demo.consent", "Victor Brand", "+15550000103"),
    mkUser("clips@demo.consent", "Casey Clips", "+15550000104"),
    mkUser("news@demo.consent", "Dana News", "+15550000105"),
    mkUser("pod@demo.consent", "Pat Podcast", "+15550000106"),
  ]);

  const ownerPerms = { canApprove: true, canNegotiate: true, canEditRules: true, canExport: true, canManageTeam: true };
  const year = new Date();
  year.setFullYear(year.getFullYear() + 1);

  // Consenters: person, TV show, brand — all verified
  const janeC = await db.consenterProfile.create({
    data: {
      slug: "jane-carter",
      displayName: "Jane Carter",
      legalName: "Jane Elizabeth Carter",
      normalizedLegalName: normalizeLegalName("Jane Elizabeth Carter"),
      entityType: "PERSON",
      aliases: ["JC", "janecarterofficial"],
      bio: "Actor and creator. Happy to support news & commentary — ask first for everything else.",
      country: "US",
      category: "actor",
      status: "APPROVED",
      verifiedAt: new Date(),
      contactEmail: "mgmt@janecarter.example",
      shareEmail: true,
      consentPrice: 25,
      consentPriceCurrency: "USD",
      payoutDetails: "Chase •• 1182 (demo)",
      score: 760,
      members: { create: { userId: jane.id, role: "OWNER", ...ownerPerms } },
      socialAccounts: { create: [{ platformName: "Instagram", handle: "@janecarter", verifiedVia: "oauth", verifiedAt: new Date() }] },
    },
  });
  const showC = await db.consenterProfile.create({
    data: {
      slug: "nightwatch-series",
      displayName: "Nightwatch (TV series)",
      legalName: "Nightwatch Productions LLC",
      normalizedLegalName: normalizeLegalName("Nightwatch Productions LLC"),
      entityType: "TV_SHOW",
      aliases: ["Nightwatch", "NW"],
      bio: "Crime drama, 4 seasons. Clips and stills licensed for commentary and review.",
      country: "US",
      category: "TV drama",
      status: "APPROVED",
      verifiedAt: new Date(),
      contactEmail: "licensing@nightwatch.example",
      shareEmail: true,
      shareManager: true,
      managerContact: "Nina Producer — nina@nightwatch.example",
      consentPrice: 100,
      consentPriceCurrency: "USD",
      payoutDetails: "Nightwatch Productions LLC — Mercury •• 7410 (demo)",
      score: 640,
      members: { create: { userId: showOwner.id, role: "OWNER", ...ownerPerms } },
    },
  });
  const brandC = await db.consenterProfile.create({
    data: {
      slug: "volt-energy",
      displayName: "Volt Energy",
      legalName: "Volt Energy Drinks Pvt Ltd",
      normalizedLegalName: normalizeLegalName("Volt Energy Drinks Pvt Ltd"),
      entityType: "BRAND",
      bio: "Energy drink brand. Logo and trademark use is strictly controlled.",
      country: "IN",
      category: "beverage brand",
      status: "APPROVED",
      verifiedAt: new Date(),
      contactEmail: "legal@voltenergy.example",
      score: 510,
      members: { create: { userId: brandOwner.id, role: "OWNER", ...ownerPerms } },
    },
  });

  // Requesters
  const clipsR = await db.requesterProfile.create({
    data: {
      slug: "acme-clips",
      displayName: "Acme Clips",
      legalName: "Casey Clips (sole proprietor)",
      type: "INDIVIDUAL_CREATOR",
      country: "US",
      description: "Daily entertainment clips and commentary for YouTube and Instagram.",
      categories: ["entertainment", "commentary"],
      channels: [{ platform: "YouTube", url: "https://youtube.com/@acmeclips", followers: 220000 }],
      status: "APPROVED",
      approvedAt: new Date(),
      onboardingFeePaidAt: new Date(),
      subscriptionEndsAt: year,
      contactEmail: "casey@acmeclips.example",
      score: 705,
      members: { create: { userId: clipsOwner.id, role: "OWNER" } },
    },
  });
  const newsR = await db.requesterProfile.create({
    data: {
      slug: "daily-lens-news",
      displayName: "Daily Lens News",
      legalName: "Daily Lens Media House Pvt Ltd",
      type: "NEWS_CHANNEL",
      country: "IN",
      description: "Independent news channel covering entertainment and tech.",
      categories: ["news"],
      channels: [{ platform: "YouTube", url: "https://youtube.com/@dailylens", followers: 1800000 }],
      signatoryName: "Dana News, Editor-in-chief",
      status: "APPROVED",
      approvedAt: new Date(),
      onboardingFeePaidAt: new Date(),
      subscriptionEndsAt: year,
      contactEmail: "desk@dailylens.example",
      score: 775,
      members: { create: { userId: newsOwner.id, role: "OWNER" } },
    },
  });
  await db.requesterProfile.create({
    data: {
      slug: "night-owls-podcast",
      displayName: "Night Owls Podcast",
      legalName: "Night Owls Audio LLP",
      type: "PODCAST",
      country: "GB",
      description: "Weekly pop-culture podcast. Application pending review (demo of the admin queue).",
      categories: ["podcast", "pop culture"],
      channels: [{ platform: "Spotify", url: "https://open.spotify.com/show/nightowls", followers: 54000 }],
      status: "SUBMITTED",
      members: { create: { userId: podOwner.id, role: "OWNER" } },
    },
  });

  // Jane prices by intent: news free, commentary cheap, promotion premium
  const intentByName = async (n: string) => (await db.intentCategory.findFirstOrThrow({ where: { name: n } })).id;
  for (const [name, amount] of [["News", 0], ["Commentary", 10], ["Promotion", 250]] as const) {
    await db.consentPriceTier.create({
      data: { consenterId: janeC.id, intentCategoryId: await intentByName(name), amount },
    });
  }

  // Consent matrix for Jane: YouTube + Instagram
  const platforms = await db.platform.findMany({ include: { formats: true } });
  const assetTypes = await db.assetType.findMany();
  const at = (name: string) => assetTypes.find((a) => a.name === name)!.id;
  const yt = platforms.find((p) => p.name === "YouTube")!;
  const ig = platforms.find((p) => p.name === "Instagram")!;
  const matrixRows: Prisma.ConsentMatrixEntryCreateManyInput[] = [];
  for (const p of [yt, ig]) {
    for (const f of p.formats) {
      for (const a of assetTypes) {
        const policy =
          a.name === "Likeness in AI-generated content"
            ? "AUTO_DENY"
            : a.name === "Name" || a.name === "Photo/picture"
              ? "AUTO_APPROVE"
              : "ASK";
        matrixRows.push({
          consenterId: janeC.id,
          platformId: p.id,
          formatId: f.id,
          assetTypeId: a.id,
          policy,
          maxDurationSec: f.isTimed ? 60 : null,
          thumbnailAllowed: true,
          paidDefault: false,
        });
      }
    }
  }
  await db.consentMatrixEntry.createMany({ data: matrixRows });

  // Standing rules
  await db.standingRule.create({
    data: {
      consenterId: janeC.id,
      name: "Auto-approve whitelisted news (name/photo, ≤30s)",
      priority: 1,
      conditions: { requesterTypes: ["NEWS_CHANNEL"], assetTypeIds: [at("Name"), at("Photo/picture")], maxDurationSec: 30, whitelistOnly: true },
      action: "AUTO_APPROVE",
      createdById: jane.id,
      createdByName: "Jane Carter",
    },
  });
  await db.standingRule.create({
    data: {
      consenterId: brandC.id,
      name: "Never allow AI likeness",
      priority: 1,
      conditions: { assetTypeIds: [at("Likeness in AI-generated content")] },
      action: "AUTO_DENY",
      createdById: brandOwner.id,
      createdByName: "Victor Brand",
    },
  });
  // Whitelist Daily Lens for Jane
  await db.listEntry.create({
    data: { kind: "WHITELIST", consenterId: janeC.id, requesterId: newsR.id, note: "Trusted newsroom" },
  });

  const intents = await db.intentCategory.findMany();
  const intent = (name: string) => intents.find((i) => i.name === name)!;
  const sel = (p: typeof yt, formatName: string, durationSec?: number) => {
    const f = p.formats.find((x) => x.name === formatName)!;
    return { platformId: p.id, platformName: p.name, formatId: f.id, formatName: f.name, durationSec: durationSec ?? null };
  };
  const payFee = (requesterId: string, requestId: string, amount: number, currency: string, status: "PAID" | "FORFEITED" = "PAID") =>
    db.payment.create({
      data: {
        requesterId,
        purpose: "PER_REQUEST",
        amount: new Prisma.Decimal(amount),
        currency,
        provider: "mock",
        status,
        requestId,
        paidAt: new Date(),
        invoiceNumber: `INV-DEMO-${requestId.slice(-6)}`,
      },
    });

  // 1. APPROVED with grant + certificate (Acme → Jane)
  const approved = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: janeC.id,
      status: "PENDING",
      selections: [sel(yt, "Shorts", 25)],
      assetTypeIds: [at("Name"), at("Photo/picture")],
      assetTypeNames: ["Name", "Photo/picture"],
      context: "A 25-second YouTube Short celebrating Jane's award win, using one red-carpet photo.",
      creativePlan:
        "We open on the award announcement, show the red-carpet photo for ~4 seconds with a congratulatory voice-over, and end with a call to watch her acceptance speech. Intent is a tribute; tone is celebratory and respectful throughout the piece.",
      intentCategoryId: intent("Tribute").id,
      intentCategoryName: "Tribute",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 3 * 86400_000),
      decidedAt: new Date(Date.now() - 2 * 86400_000),
      decidedById: jane.id,
      agreementMode: "APP_RECORD",
      isPaid: false,
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "approved", actorName: "Jane Carter", actorSide: "consenter" },
        ],
      },
    },
  });
  await payFee(clipsR.id, approved.id, 9, "USD");
  await demoFile({ kind: "ASSET", name: "red-carpet-photo.txt", content: "DEMO ASSET — red carpet photo placeholder", requestId: approved.id, uploadedById: clipsOwner.id });
  await demoFile({ kind: "RAW_CONTENT", name: "short-final-cut.txt", content: "DEMO RAW CONTENT — final 25s short placeholder", requestId: approved.id, uploadedById: clipsOwner.id });
  await issueGrant(approved.id, "Jane Carter");

  // 2. PENDING with SLA (Daily Lens → Jane)
  const pending = await db.consentRequest.create({
    data: {
      requesterId: newsR.id,
      consenterId: janeC.id,
      status: "PENDING",
      selections: [sel(yt, "Long video", 90)],
      assetTypeIds: [at("Video reference/clip"), at("Name")],
      assetTypeNames: ["Video reference/clip", "Name"],
      context: "News segment about streaming industry pay, quoting Jane's recent interview for 90 seconds.",
      creativePlan:
        "An 8-minute news analysis piece. Jane's interview clip appears at 2:10 for up to 90 seconds with attribution on screen. Our intent is news reporting with commentary from two industry analysts following the clip.",
      intentCategoryId: intent("News").id,
      intentCategoryName: "News",
      validityKind: "PERPETUAL",
      submittedAt: new Date(),
      slaExpiresAt: new Date(Date.now() + 7 * 86400_000),
      events: { create: [{ type: "submitted", actorSide: "requester" }] },
    },
  });
  await payFee(newsR.id, pending.id, 299, "INR");

  // 3. IN_NEGOTIATION with offers (Acme → Nightwatch)
  const nego = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: showC.id,
      status: "IN_NEGOTIATION",
      isPaid: true,
      selections: [sel(yt, "Long video", 45), sel(ig, "Reel", 30)],
      assetTypeIds: [at("Character/show footage"), at("Poster/still")],
      assetTypeNames: ["Character/show footage", "Poster/still"],
      thumbnailUsed: true,
      context: "Season 4 finale reaction video using three short scenes and the season poster.",
      creativePlan:
        "A 12-minute reaction/review of the Nightwatch season finale. Three scenes (15s each) are shown with pause-and-comment analysis, plus the poster in the thumbnail. Intent is review and commentary; spoilers flagged in the first 10 seconds.",
      intentCategoryId: intent("Review").id,
      intentCategoryName: "Review",
      validityKind: "DATE_RANGE",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 90 * 86400_000),
      submittedAt: new Date(Date.now() - 86400_000),
      lastOfferAt: new Date(),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "marked_paid", actorName: "Nina Producer", actorSide: "consenter", detail: { amount: "500.00", currency: "USD" } },
          { type: "offer_made", actorName: "Casey Clips", actorSide: "requester", detail: { amount: "300.00", currency: "USD" } },
        ],
      },
      offers: {
        create: [
          { version: 1, bySide: "consenter", byUserId: showOwner.id, amount: new Prisma.Decimal(500), currency: "USD", status: "SUPERSEDED" },
          { version: 2, bySide: "requester", byUserId: clipsOwner.id, amount: new Prisma.Decimal(300), currency: "USD", scopeNote: "Happy to drop the Instagram reel if that helps.", status: "OPEN" },
        ],
      },
      messages: {
        create: [
          { senderId: clipsOwner.id, senderSide: "requester", body: "Big fan of the show — can we talk about a fair rate for three short scenes?" },
          { senderId: showOwner.id, senderSide: "consenter", body: "Thanks — finale scenes are premium for the next quarter, hence the number." },
        ],
      },
    },
  });
  await payFee(clipsR.id, nego.id, 9, "USD");
  await demoFile({ kind: "ASSET", name: "scene-list.txt", content: "DEMO ASSET — scene list placeholder", requestId: nego.id, uploadedById: clipsOwner.id });

  // 4. CHANGES_REQUESTED (Daily Lens → Nightwatch)
  const changes = await db.consentRequest.create({
    data: {
      requesterId: newsR.id,
      consenterId: showC.id,
      status: "CHANGES_REQUESTED",
      selections: [sel(yt, "Long video", 60)],
      assetTypeIds: [at("Character/show footage")],
      assetTypeNames: ["Character/show footage"],
      context: "Feature about on-set safety using one minute of behind-the-scenes footage.",
      creativePlan:
        "Investigative feature (10 min) on production safety standards. Nightwatch BTS footage illustrates best practice examples; our intent is news and education, with the production credited on screen throughout.",
      intentCategoryId: intent("News").id,
      intentCategoryName: "News",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 2 * 86400_000),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "changes_requested", actorName: "Nina Producer", actorSide: "consenter", detail: { note: "Please trim the stunt sequence out of the BTS reel and resubmit." } },
        ],
      },
    },
  });
  await payFee(newsR.id, changes.id, 299, "INR");

  // 5. DENIED (Acme → Volt)
  const denied = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: brandC.id,
      status: "DENIED",
      selections: [sel(ig, "Reel", 20)],
      assetTypeIds: [at("Logo/trademark")],
      assetTypeNames: ["Logo/trademark"],
      context: "Comedy skit where the Volt logo appears on a prop can.",
      creativePlan:
        "A 20-second comedy reel where our character drinks a 'Volt' can before absurd parkour. Intent is parody/entertainment; the brand is shown positively but comedically throughout the sketch.",
      intentCategoryId: intent("Parody").id,
      intentCategoryName: "Parody",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 5 * 86400_000),
      decidedAt: new Date(Date.now() - 4 * 86400_000),
      decidedById: brandOwner.id,
      denialReason: "Does not fit my brand — We avoid stunt/parkour association for safety reasons.",
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "denied", actorName: "Victor Brand", actorSide: "consenter" },
        ],
      },
    },
  });
  await payFee(clipsR.id, denied.id, 9, "USD");

  // 6. EXPIRED_NO_RESPONSE with forfeited fee (Daily Lens → Volt)
  const expired = await db.consentRequest.create({
    data: {
      requesterId: newsR.id,
      consenterId: brandC.id,
      status: "EXPIRED_NO_RESPONSE",
      selections: [sel(yt, "Long video", 30)],
      assetTypeIds: [at("Logo/trademark"), at("Name")],
      assetTypeNames: ["Logo/trademark", "Name"],
      context: "Market report on the energy drink sector naming Volt with its logo chart.",
      creativePlan:
        "Quarterly beverage market report (7 min). Volt appears in a market-share chart with its logo for 30 seconds. Intent is news reporting; all figures sourced from public filings and cited on screen.",
      intentCategoryId: intent("News").id,
      intentCategoryName: "News",
      validityKind: "PERPETUAL",
      submittedAt: new Date(Date.now() - 12 * 86400_000),
      slaExpiresAt: new Date(Date.now() - 5 * 86400_000),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "auto_expired", actorSide: "system", detail: { feeForfeited: true } },
        ],
      },
    },
  });
  await payFee(newsR.id, expired.id, 299, "INR", "FORFEITED");

  // 7. DEAL_AGREED → AGREEMENT_MODE_PENDING with contacts revealed (Daily Lens → Jane)
  const deal = await db.consentRequest.create({
    data: {
      requesterId: newsR.id,
      consenterId: janeC.id,
      status: "AGREEMENT_MODE_PENDING",
      isPaid: true,
      agreedAmount: new Prisma.Decimal(750),
      agreedCurrency: "USD",
      contactsRevealed: true,
      contactsSnapshot: {
        consenter: { name: "Jane Carter", email: "mgmt@janecarter.example", phone: null, manager: null },
        requester: { name: "Daily Lens News", email: "desk@dailylens.example", phone: null, manager: null },
        revealedAt: new Date().toISOString(),
      },
      selections: [sel(yt, "Long video", 120)],
      assetTypeIds: [at("Voice/audio clip"), at("Name")],
      assetTypeNames: ["Voice/audio clip", "Name"],
      context: "Documentary-style feature using 2 minutes of Jane's podcast audio.",
      creativePlan:
        "A 15-minute feature on voice acting careers. Jane's podcast audio illustrates her craft commentary; our intent is documentary and education, with full attribution and a link to the original podcast episode.",
      intentCategoryId: intent("Documentary").id,
      intentCategoryName: "Documentary",
      validityKind: "DATE_RANGE",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 365 * 86400_000),
      submittedAt: new Date(Date.now() - 4 * 86400_000),
      decidedAt: new Date(Date.now() - 86400_000),
      decidedById: jane.id,
      offers: {
        create: [
          { version: 1, bySide: "consenter", byUserId: jane.id, amount: new Prisma.Decimal(900), currency: "USD", status: "SUPERSEDED" },
          { version: 2, bySide: "requester", byUserId: newsOwner.id, amount: new Prisma.Decimal(750), currency: "USD", status: "ACCEPTED" },
        ],
      },
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "marked_paid", actorName: "Jane Carter", actorSide: "consenter", detail: { amount: "900.00", currency: "USD" } },
          { type: "offer_made", actorName: "Dana News", actorSide: "requester", detail: { amount: "750.00", currency: "USD" } },
          { type: "deal_agreed", actorName: "Jane Carter", actorSide: "consenter", detail: { amount: "750.00", currency: "USD" } },
        ],
      },
    },
  });
  await payFee(newsR.id, deal.id, 299, "INR");

  // 8. WITHDRAWN (Acme → Jane)
  const withdrawn = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: janeC.id,
      status: "WITHDRAWN",
      selections: [sel(ig, "Story", 10)],
      assetTypeIds: [at("Photo/picture")],
      assetTypeNames: ["Photo/picture"],
      context: "Story repost of a fan photo (withdrawn — found a different photo).",
      creativePlan:
        "A 10-second Instagram story reposting a public appearance photo with a positive caption tagging Jane. Intent was entertainment; we withdrew after choosing different content for the slot.",
      intentCategoryId: intent("Entertainment").id,
      intentCategoryName: "Entertainment",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 6 * 86400_000),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "withdrawn", actorName: "Casey Clips", actorSide: "requester" },
        ],
      },
    },
  });
  await payFee(clipsR.id, withdrawn.id, 9, "USD");

  // Report (OPEN) on the approved request + takedown RAISED on its grant
  await db.report.create({
    data: {
      requestId: approved.id,
      bySide: "consenter",
      reason: "Missing consent link",
      description: "The published short does not include the verification link in its description as required by the terms of use.",
      evidenceLinks: ["https://youtube.com/shorts/demo123"],
    },
  });
  const grant = await db.grant.findUnique({ where: { requestId: approved.id } });
  if (grant) {
    await db.takedownRequest.create({
      data: {
        grantId: grant.id,
        reason: "Missing consent link after two reminders",
        liveLinks: ["https://youtube.com/shorts/demo123"],
        respondBy: new Date(Date.now() + 7 * 86400_000),
      },
    });
  }

  // Remaining demo states: DRAFT, CLOSED, APPROVED_IN_PRINCIPLE, LEGAL_AGREEMENT_PENDING
  await db.consentRequest.create({
    data: {
      requesterId: newsR.id, consenterId: showC.id, status: "DRAFT",
      selections: [sel(yt, "Shorts", 15)], assetTypeIds: [at("Poster/still")], assetTypeNames: ["Poster/still"],
      context: "", creativePlan: "", validityKind: "SINGLE_PUBLICATION",
    },
  });
  const closed = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id, consenterId: showC.id, status: "CLOSED",
      closedReason: "requester walked away", isPaid: true,
      selections: [sel(yt, "Long video", 50)], assetTypeIds: [at("Character/show footage")], assetTypeNames: ["Character/show footage"],
      context: "Compilation of iconic Nightwatch moments across four seasons.",
      creativePlan: "A ten-minute ranked compilation of the show's most iconic scenes with commentary between clips. Intent is entertainment; negotiation on the licensing fee did not reach agreement and we walked away politely.",
      intentCategoryId: intent("Entertainment").id, intentCategoryName: "Entertainment",
      validityKind: "SINGLE_PUBLICATION", submittedAt: new Date(Date.now() - 9 * 86400_000),
      events: { create: [{ type: "submitted", actorSide: "requester" }, { type: "closed", actorName: "Casey Clips", actorSide: "requester" }] },
      offers: { create: [{ version: 1, bySide: "consenter", byUserId: showOwner.id, amount: new Prisma.Decimal(1200), currency: "USD", status: "OPEN" }] },
    },
  });
  await payFee(clipsR.id, closed.id, 9, "USD");
  const inPrinciple = await db.consentRequest.create({
    data: {
      requesterId: newsR.id, consenterId: janeC.id, status: "APPROVED_IN_PRINCIPLE",
      selections: [sel(yt, "Community post")], assetTypeIds: [at("Name")], assetTypeNames: ["Name"],
      context: "Community post announcing our interview special featuring Jane by name.",
      creativePlan: "A community post teaser naming Jane ahead of our interview special. Intent is promotion of a news program; final artwork is still in production, so approval in principle while we finish the asset.",
      intentCategoryId: intent("Promotion").id, intentCategoryName: "Promotion",
      validityKind: "SINGLE_PUBLICATION", submittedAt: new Date(Date.now() - 2 * 86400_000),
      decidedAt: new Date(Date.now() - 86400_000), decidedById: jane.id, agreementMode: "APP_RECORD",
      events: { create: [{ type: "submitted", actorSide: "requester" }, { type: "approved", actorName: "Jane Carter", actorSide: "consenter" }] },
    },
  });
  await payFee(newsR.id, inPrinciple.id, 299, "INR");
  const legalPending = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id, consenterId: janeC.id, status: "LEGAL_AGREEMENT_PENDING",
      isPaid: true, agreedAmount: new Prisma.Decimal(400), agreedCurrency: "USD",
      selections: [sel(ig, "Reel", 20)], assetTypeIds: [at("Voice/audio clip")], assetTypeNames: ["Voice/audio clip"],
      context: "Reel using a 20-second clip of Jane's podcast audio over subtitled visuals.",
      creativePlan: "A 20-second reel pairing Jane's podcast quote with subtitled motion graphics. Intent is commentary on creator economics; the deal is agreed and the parties chose a legally binding agreement before issuance.",
      intentCategoryId: intent("Commentary").id, intentCategoryName: "Commentary",
      validityKind: "DATE_RANGE", validFrom: new Date(), validUntil: new Date(Date.now() + 180 * 86400_000),
      submittedAt: new Date(Date.now() - 3 * 86400_000), decidedAt: new Date(Date.now() - 86400_000), decidedById: jane.id,
      events: { create: [{ type: "submitted", actorSide: "requester" }, { type: "deal_agreed", actorName: "Jane Carter", actorSide: "consenter" }, { type: "legal_agreement_proposed", actorName: "Jane Carter", actorSide: "consenter" }] },
      agreement: { create: { status: "PROPOSED", proposedBySide: "consenter" } },
    },
  });
  await payFee(clipsR.id, legalPending.id, 9, "USD");

  console.log("Demo data ready. Logins (password: Password1!):");
  console.log("  admin@consent.app — Super Admin");
  console.log("  jane@demo.consent — consenter (person)");
  console.log("  show@demo.consent — consenter (TV show)");
  console.log("  brand@demo.consent — consenter (brand)");
  console.log("  clips@demo.consent — requester (creator)");
  console.log("  news@demo.consent — requester (news channel)");
  console.log("  pod@demo.consent — requester (application pending)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
