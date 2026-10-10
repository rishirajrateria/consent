/* Seed: catalog data, currencies, membership prices, admin roles, CMS pages
   and demo accounts, plus full demo data. Every account is the same: each
   persona has ONE profile (a pair: the profile and its sending half, OWNER
   seats in both) that can both ask and be asked. Requests cover the whole
   lifecycle (one issued certificate, a question asked, a yes waiting for the
   final file, declined, expired, withdrawn, closed) with money that matches
   the 80/20 split. Run: npm run db:seed */
import { PrismaClient, Prisma, type ConsenterEntityType, type RequesterType, type RequestStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { storage } from "../src/lib/storage";
import { issueGrant } from "../src/lib/grants";
import { normalizeLegalName } from "../src/lib/utils";
import { DEFAULT_CURRENCIES } from "../src/lib/currency-rules";
import { requestCharges } from "../src/lib/platform-fee";
import { splitConsentFee } from "../src/lib/escrow";

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
  "Concerns about who is asking", "Already given to someone else", "Rights held by someone else", "Other",
];

/** Admin modules. "consenters" is the one ID-check module (shown as "Profiles"). */
const MODULES = ["consenters", "users", "requests", "reports", "scores", "catalog", "pricing", "payments", "settings", "cms", "audit", "takedowns", "analytics"];

const PRICING_NOTE = `Being asked is always free. Asking is free when the person you ask is free to ask: no fee, no checkout, the request is sent at once.

Otherwise you pay their consent request fee (from about ₹100, in the currency they chose) plus a platform fee of 20% of it. The consent request fee is held until they answer: on a yes, 80% goes to them, paid out on Fridays; otherwise 80% comes back to you. Consent keeps 20% either way. The platform fee is never refunded.

Membership is ₹1,000 a year for every account, and free for now.`;

const FAQ = `### Why does this matter now?
A voice can be cloned and a likeness generated in an afternoon. Consent makes asking normal: anyone can ask anyone, everyone sets the terms for their own name, and every yes is on the record for anyone to check.

### Is there more than one kind of account?
No. Every account is the same and goes through the same ID check. Once verified, you can ask others and be asked. Brands and shows can run a team profile that works the same way.

### What does it cost?
Being asked is free. Asking is free when the person you ask is free to ask. Otherwise you pay their consent request fee plus a 20% platform fee. The fee is held until they answer: 80% goes to them on a yes, otherwise 80% comes back to you, and Consent keeps 20%. The platform fee is never refunded. Membership is ₹1,000 a year and free for now.

### What do I get after a yes?
A tamper-proof certificate locked to the exact files that were approved, with a public link anyone can check, forever. Once it's issued, the matter is closed.

### What if someone breaks the rules?
Either of you can file a report. Upheld reports lower that profile's public Consent Score. You can export the Consent History Dossier of a request as your record.`;

const TERMS = `By using Consent you agree to:

1. Only upload content you have the rights to.
2. Include the consent verification link in published content that received a certificate.
3. The platform fee (20% of a consent request fee) is never refunded, whatever the answer.
4. A consent request fee is held until the person asked answers: 80% goes to them on a yes, otherwise 80% is refunded to the person who asked. Consent keeps 20% either way.
5. Membership, when it is charged, is yearly and isn't refunded.
6. A certificate records the permission given. Consent is not a party to how it is used.`;

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

  console.log("Seeding currencies and membership prices…");
  // The currencies a consent request fee can be set in, with the smallest
  // paid fee in each (about ₹100). Admin edits are kept on a re-seed.
  for (const c of DEFAULT_CURRENCIES) {
    await db.currency.upsert({
      where: { code: c.code },
      update: {},
      create: { code: c.code, name: c.name, minConsentFee: new Prisma.Decimal(c.minConsentFee), sortOrder: c.sortOrder, active: true },
    });
  }
  // The yearly membership: the same for every account. Switched off for now.
  await db.priceConfig.upsert({
    where: { country: "DEFAULT" },
    update: {},
    create: { country: "DEFAULT", currency: "USD", membershipFee: 12, taxLabel: "VAT", taxRate: 0 },
  });
  await db.priceConfig.upsert({
    where: { country: "IN" },
    update: {},
    create: { country: "IN", currency: "INR", membershipFee: 1000, taxLabel: "GST", taxRate: 18 },
  });
  const system = await db.setting.findUnique({ where: { key: "system" } });
  const systemValue = (system?.value ?? {}) as Record<string, unknown>;
  if (!("membershipFeeOn" in systemValue)) {
    const value = { ...systemValue, membershipFeeOn: false } as Prisma.InputJsonObject;
    await db.setting.upsert({ where: { key: "system" }, update: { value }, create: { key: "system", value } });
  }
  // E-signature is gone; drop its old setting.
  await db.setting.deleteMany({ where: { key: "esign_provider" } });

  console.log("Seeding admin roles…");
  const superRole = await db.adminRole.upsert({
    where: { name: "Super Admin" },
    update: { isSuperAdmin: true },
    create: { name: "Super Admin", isSuperAdmin: true },
  });
  const allView = Object.fromEntries(MODULES.map((m) => [m, ["view"]]));
  const roleDefs: [string, Record<string, string[]>][] = [
    ["Verification Officer", { ...allView, consenters: ["view", "edit", "approve"] }],
    ["Support", { ...allView, users: ["view", "edit"] }],
    ["Finance", { ...allView, pricing: ["view", "create", "edit"], payments: ["view", "edit", "export"] }],
    ["Trust & Safety", { ...allView, reports: ["view", "edit", "approve"], scores: ["view", "edit"], users: ["view", "edit"], takedowns: ["view", "edit"] }],
    ["Content Moderator", { ...allView, requests: ["view", "edit"] }],
    ["Analyst", { ...allView, analytics: ["view", "export"] }],
  ];
  for (const [name, permissions] of roleDefs) {
    await db.adminRole.upsert({ where: { name }, update: { permissions }, create: { name, permissions } });
  }

  console.log("Seeding CMS pages…");
  const pages: [string, string, string][] = [
    ["pricing-note", "Pricing notes", PRICING_NOTE],
    ["faq", "FAQ", FAQ],
    ["terms", "Terms of Service", TERMS],
    ["privacy", "Privacy Policy", "We keep permanent, timestamped records, store document numbers only as scrambled identifiers, and keep files in private, access-controlled storage with expiring links. You may export your data or request deletion; certificates and audit logs are retained as legally required. GDPR and India DPDP aware."],
    ["contact", "Contact", "Email support@consent.app. We answer within 2 business days."],
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
      // 2FA is set up at first sign-in (every account needs it).
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
  kind: "ASSET" | "RAW_CONTENT" | "THUMBNAIL" | "DOCUMENT" | "PROFILE_PHOTO";
  name: string;
  content: string | Buffer;
  mime?: string;
  requestId?: string;
  uploadedById: string;
  consenterDocOf?: string;
  requesterDocOf?: string;
}) {
  const buf = typeof opts.content === "string" ? Buffer.from(opts.content) : opts.content;
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const key = `${opts.kind.toLowerCase()}/${sha256.slice(0, 2)}/${sha256}-${opts.name}`;
  await storage.put(key, buf);
  return db.storedFile.create({
    data: {
      kind: opts.kind,
      name: opts.name,
      mime: opts.mime ?? "text/plain",
      size: buf.length,
      sha256,
      storageKey: key,
      requestId: opts.requestId,
      uploadedById: opts.uploadedById,
      consenterDocOf: opts.consenterDocOf,
      requesterDocOf: opts.requesterDocOf,
    },
  });
}

/** A 1×1 grey PNG: every demo profile has a photo, as onboarding requires. */
const DEMO_PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==",
  "base64",
);

/** The owner's seat: every permission. */
const OWNER_PERMS = { canApprove: true, canEditRules: true, canExport: true, canManageTeam: true };

type Channel = { platform: string; url: string; followers: number; proven?: boolean };

/** "@acmeclips" from "https://youtube.com/@acmeclips". */
const handleOf = (url: string) => {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  return last.startsWith("@") ? last : `@${last}`;
};

/**
 * One profile, the way onboarding creates it: the profile (its public page,
 * terms, fee, limits, earnings) and its sending half (consenterId), with the
 * same name, country and verification, an OWNER seat in both member tables,
 * the channels on both halves, one ID document linked to both, a profile
 * photo and the ID number's hash: complete, as onboarding requires.
 */
async function createProfilePair(p: {
  slug: string;
  displayName: string;
  legalName: string;
  entityType: ConsenterEntityType;
  creatorType: RequesterType;
  country: string;
  category: string;
  bio: string;
  aliases?: string[];
  channels: Channel[];
  status: "APPROVED" | "SUBMITTED";
  ownerId: string;
  /** null = free to ask. */
  consentPrice: number | null;
  consentPriceCurrency: string;
  payoutDetails?: string;
  maxOpenRequests?: number;
  /** How they answer (the profile) and how they ask (the sending half). */
  receiveScore: number;
  sendScore: number;
}) {
  const verifiedAt = p.status === "APPROVED" ? new Date() : null;
  const { c, r } = await db.$transaction(async (tx) => {
    const c = await tx.consenterProfile.create({
      data: {
        slug: p.slug,
        displayName: p.displayName,
        legalName: p.legalName,
        normalizedLegalName: normalizeLegalName(p.legalName),
        entityType: p.entityType,
        aliases: p.aliases ?? [],
        bio: p.bio,
        country: p.country,
        category: p.category,
        status: p.status,
        verifiedAt,
        consentPrice: p.consentPrice == null ? null : new Prisma.Decimal(p.consentPrice),
        consentPriceCurrency: p.consentPriceCurrency,
        payoutDetails: p.payoutDetails ?? null,
        maxOpenRequests: p.maxOpenRequests ?? null,
        score: p.receiveScore,
        members: { create: { userId: p.ownerId, role: "OWNER", ...OWNER_PERMS } },
      },
    });
    const r = await tx.requesterProfile.create({
      data: {
        consenterId: c.id,
        slug: p.slug,
        displayName: p.displayName,
        legalName: p.legalName,
        type: p.creatorType,
        country: p.country,
        description: p.bio,
        categories: [p.category],
        channels: p.channels.map(({ platform, url, followers }) => ({ platform, url, followers })),
        status: p.status,
        approvedAt: verifiedAt,
        score: p.sendScore,
        members: { create: { userId: p.ownerId, role: "OWNER" } },
      },
    });
    await tx.socialAccount.createMany({
      data: p.channels.map((ch) => ({
        platformName: ch.platform,
        handle: handleOf(ch.url),
        url: ch.url,
        followers: ch.followers,
        verifiedVia: ch.proven ? "oauth" : "manual",
        verifiedAt: ch.proven ? new Date() : null,
        consenterId: c.id,
        requesterId: r.id,
      })),
    });
    return { c, r };
  });
  // Complete, as onboarding requires: the ID document (named "<type> - <file>",
  // as onboarding stores it) linked to both halves, and a profile photo.
  await demoFile({
    kind: "DOCUMENT",
    name: `Passport - ${p.slug}-id.txt`,
    content: `DEMO ID DOCUMENT — ${p.legalName}`,
    uploadedById: p.ownerId,
    consenterDocOf: c.id,
    requesterDocOf: r.id,
  });
  const photo = await demoFile({
    kind: "PROFILE_PHOTO",
    name: `${p.slug}-photo.png`,
    content: DEMO_PHOTO,
    mime: "image/png",
    uploadedById: p.ownerId,
    consenterDocOf: c.id,
  });
  const profile = await db.consenterProfile.update({
    where: { id: c.id },
    // Onboarding keeps only a hash of the ID number (trimmed, lower-cased), for duplicate checks.
    data: { photoFileId: photo.id, documentNumberHash: createHash("sha256").update(`demo-${p.slug}`).digest("hex") },
  });
  return { profile, sender: r };
}

/**
 * What a request cost, the way checkout and the escrow record it: the consent
 * request fee (CONSENT_PRICE, held as an earning) plus the platform fee
 * (PER_REQUEST, 20% of it plus the payer's country's tax on it, never
 * refunded), on one provider checkout, each line with its own invoice. A free
 * ask has no payment at all. The earning follows the request: held while
 * open, the profile's 80% on a yes, 80% refunded on any other ending.
 */
async function payForRequest(opts: {
  requestId: string;
  requesterId: string;
  consenterId: string;
  fee: number;
  currency: string;
  status: RequestStatus;
  endedBecause?: string;
}) {
  if (opts.fee <= 0) return;
  // Tax on the platform fee is the payer's country's, as checkout's taxFor reads it.
  const payer = await db.requesterProfile.findUniqueOrThrow({ where: { id: opts.requesterId }, select: { country: true } });
  const priceConfig =
    (await db.priceConfig.findUnique({ where: { country: payer.country } })) ??
    (await db.priceConfig.findUnique({ where: { country: "DEFAULT" } }));
  const charges = requestCharges(opts.fee, { taxRate: priceConfig?.taxRate ?? null });
  const invoiceBase = `INV-DEMO-${opts.requestId.slice(-6).toUpperCase()}`;
  const providerRef = `mock_demo_${opts.requestId.slice(-8)}`;
  const paidAt = new Date(Date.now() - 86400_000);
  const split = splitConsentFee(opts.fee);
  const outcome = ["APPROVED", "APPROVED_IN_PRINCIPLE"].includes(opts.status)
    ? "release"
    : ["DENIED", "CLOSED", "EXPIRED_NO_RESPONSE", "WITHDRAWN"].includes(opts.status)
      ? "refund"
      : "hold";
  await db.payment.create({
    data: {
      requesterId: opts.requesterId,
      purpose: "PER_REQUEST",
      amount: new Prisma.Decimal(charges.platformTotal.toFixed(2)),
      tax: charges.tax > 0 ? new Prisma.Decimal(charges.tax.toFixed(2)) : null,
      taxLabel: charges.tax > 0 ? (priceConfig?.taxLabel ?? "Tax") : null,
      currency: opts.currency,
      provider: "mock",
      providerRef,
      status: "PAID",
      requestId: opts.requestId,
      paidAt,
      invoiceNumber: invoiceBase,
    },
  });
  const consentPayment = await db.payment.create({
    data: {
      requesterId: opts.requesterId,
      purpose: "CONSENT_PRICE",
      amount: new Prisma.Decimal(split.gross),
      currency: opts.currency,
      provider: "mock",
      providerRef,
      status: outcome === "refund" ? "REFUNDED" : "PAID",
      requestId: opts.requestId,
      paidAt,
      // Every settled line gets its own invoice, as settlePayment does.
      invoiceNumber: `${invoiceBase}-C`,
      ...(outcome === "refund"
        ? { refundedAt: new Date(), refundRef: `mock_refund_${opts.requestId.slice(-8)}`, refundedAmount: new Prisma.Decimal(split.refund) }
        : {}),
    },
  });
  await db.earningEntry.create({
    data: {
      consenterId: opts.consenterId,
      requestId: opts.requestId,
      paymentId: consentPayment.id,
      amount: new Prisma.Decimal(split.owner),
      grossAmount: new Prisma.Decimal(split.gross),
      currency: opts.currency,
      status: outcome === "release" ? "PENDING" : outcome === "refund" ? "REFUNDED" : "HELD",
      reversedReason: outcome === "refund" ? opts.endedBecause ?? "Request ended without a yes" : null,
    },
  });
  if (outcome === "refund") {
    await db.requestEvent.create({
      data: {
        requestId: opts.requestId,
        type: "consent_fee_refunded",
        actorSide: "system",
        detail: { fee: split.gross.toFixed(2), refunded: split.refund.toFixed(2), currency: opts.currency },
      },
    });
  }
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

  // ── Profiles: one per persona, every one able to ask and be asked ──
  const { profile: janeC, sender: janeR } = await createProfilePair({
    slug: "jane-carter",
    displayName: "Jane Carter",
    legalName: "Jane Elizabeth Carter",
    entityType: "PERSON",
    creatorType: "INDIVIDUAL_CREATOR",
    aliases: ["JC", "janecarterofficial"],
    bio: "Actor and creator. Happy to support news and commentary. Ask first for everything else.",
    country: "US",
    category: "actor",
    channels: [
      { platform: "Instagram", url: "https://instagram.com/janecarter", followers: 1200000, proven: true },
      { platform: "YouTube", url: "https://youtube.com/@janecarter", followers: 340000 },
    ],
    status: "APPROVED",
    ownerId: jane.id,
    consentPrice: 25,
    consentPriceCurrency: "USD",
    payoutDetails: "Chase •• 1182 (demo)",
    // Demo request limit: new requests pause while 20 wait for Jane's answer.
    maxOpenRequests: 20,
    receiveScore: 760,
    sendScore: 700,
  });
  const { profile: showC } = await createProfilePair({
    slug: "nightwatch-series",
    displayName: "Nightwatch (TV series)",
    legalName: "Nightwatch Productions LLC",
    entityType: "TV_SHOW",
    creatorType: "MEDIA_HOUSE",
    aliases: ["Nightwatch", "NW"],
    bio: "Crime drama, 4 seasons. Clips and stills licensed for commentary and review.",
    country: "US",
    category: "TV drama",
    channels: [{ platform: "YouTube", url: "https://youtube.com/@nightwatchseries", followers: 650000, proven: true }],
    status: "APPROVED",
    ownerId: showOwner.id,
    consentPrice: 100,
    consentPriceCurrency: "USD",
    payoutDetails: "Nightwatch Productions LLC — Mercury •• 7410 (demo)",
    receiveScore: 640,
    sendScore: 600,
  });
  const { profile: brandC } = await createProfilePair({
    slug: "volt-energy",
    displayName: "Volt Energy",
    legalName: "Volt Energy Drinks Pvt Ltd",
    entityType: "BRAND",
    creatorType: "AGENCY",
    bio: "Energy drink brand. Logo and trademark use is strictly controlled.",
    country: "IN",
    category: "beverage brand",
    channels: [{ platform: "Instagram", url: "https://instagram.com/voltenergy", followers: 210000, proven: true }],
    status: "APPROVED",
    ownerId: brandOwner.id,
    // Free to ask.
    consentPrice: null,
    consentPriceCurrency: "INR",
    receiveScore: 510,
    sendScore: 520,
  });
  const { profile: clipsC, sender: clipsR } = await createProfilePair({
    slug: "acme-clips",
    displayName: "Acme Clips",
    legalName: "Casey Clips (sole proprietor)",
    entityType: "OTHER",
    creatorType: "INDIVIDUAL_CREATOR",
    bio: "Daily entertainment clips and commentary for YouTube and Instagram.",
    country: "US",
    category: "entertainment clips",
    channels: [
      { platform: "YouTube", url: "https://youtube.com/@acmeclips", followers: 220000, proven: true },
      { platform: "Instagram", url: "https://instagram.com/acmeclips", followers: 85000 },
      { platform: "TikTok", url: "https://tiktok.com/@acmeclips", followers: 140000 },
      { platform: "X (Twitter)", url: "https://x.com/acmeclips", followers: 12000 },
      { platform: "Facebook", url: "https://facebook.com/acmeclips", followers: 30000 },
      { platform: "LinkedIn", url: "https://linkedin.com/company/acmeclips", followers: 4000 },
    ],
    status: "APPROVED",
    ownerId: clipsOwner.id,
    consentPrice: null,
    consentPriceCurrency: "USD",
    receiveScore: 500,
    sendScore: 705,
  });
  const { sender: newsR } = await createProfilePair({
    slug: "daily-lens-news",
    displayName: "Daily Lens News",
    legalName: "Daily Lens Media House Pvt Ltd",
    entityType: "OTHER",
    creatorType: "NEWS_CHANNEL",
    bio: "Independent news channel covering entertainment and tech.",
    country: "IN",
    category: "news channel",
    channels: [
      { platform: "YouTube", url: "https://youtube.com/@dailylens", followers: 1800000, proven: true },
      { platform: "Facebook", url: "https://facebook.com/dailylensnews", followers: 410000 },
      { platform: "X (Twitter)", url: "https://x.com/dailylensnews", followers: 260000 },
      { platform: "Instagram", url: "https://instagram.com/dailylensnews", followers: 95000 },
      { platform: "LinkedIn", url: "https://linkedin.com/company/dailylens", followers: 22000 },
    ],
    status: "APPROVED",
    ownerId: newsOwner.id,
    consentPrice: null,
    consentPriceCurrency: "INR",
    receiveScore: 500,
    sendScore: 775,
  });
  // The one ID check waiting in the admin queue.
  await createProfilePair({
    slug: "night-owls-podcast",
    displayName: "Night Owls Podcast",
    legalName: "Night Owls Audio LLP",
    entityType: "OTHER",
    creatorType: "PODCAST",
    bio: "Weekly pop-culture podcast. Application waiting for its ID check (demo of the admin queue).",
    country: "GB",
    category: "podcast",
    channels: [{ platform: "Spotify", url: "https://open.spotify.com/show/nightowls", followers: 54000 }],
    status: "SUBMITTED",
    ownerId: podOwner.id,
    consentPrice: null,
    consentPriceCurrency: "GBP",
    receiveScore: 500,
    sendScore: 500,
  });

  // Jane's fees by use: news is free, commentary costs less than her base fee.
  const intentByName = async (n: string) => (await db.intentCategory.findFirstOrThrow({ where: { name: n } })).id;
  for (const [name, amount] of [["News", 0], ["Commentary", 10]] as const) {
    await db.consentPriceTier.create({
      data: { consenterId: janeC.id, intentCategoryId: await intentByName(name), amount },
    });
  }

  // Jane's terms: YouTube + Instagram
  const platforms = await db.platform.findMany({ include: { formats: true } });
  const assetTypes = await db.assetType.findMany();
  const at = (name: string) => assetTypes.find((a) => a.name === name)!.id;
  const yt = platforms.find((x) => x.name === "YouTube")!;
  const ig = platforms.find((x) => x.name === "Instagram")!;
  const matrixRows: Prisma.ConsentMatrixEntryCreateManyInput[] = [];
  for (const pl of [yt, ig]) {
    for (const f of pl.formats) {
      for (const a of assetTypes) {
        const policy =
          a.name === "Likeness in AI-generated content"
            ? "AUTO_DENY"
            : a.name === "Name" || a.name === "Photo/picture"
              ? "AUTO_APPROVE"
              : "ASK";
        matrixRows.push({
          consenterId: janeC.id,
          platformId: pl.id,
          formatId: f.id,
          assetTypeId: a.id,
          policy,
          maxDurationSec: f.isTimed ? 60 : null,
          thumbnailAllowed: true,
        });
      }
    }
  }
  await db.consentMatrixEntry.createMany({ data: matrixRows });

  // Standing rules
  await db.standingRule.create({
    data: {
      consenterId: janeC.id,
      name: "Auto-approve trusted newsrooms (name/photo, ≤30s)",
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
  // Jane trusts Daily Lens
  await db.listEntry.create({
    data: { kind: "WHITELIST", consenterId: janeC.id, requesterId: newsR.id, note: "Trusted newsroom" },
  });

  const intents = await db.intentCategory.findMany();
  const intent = (name: string) => intents.find((i) => i.name === name)!;
  const sel = (pl: typeof yt, formatName: string, durationSec?: number) => {
    const f = pl.formats.find((x) => x.name === formatName)!;
    return { platformId: pl.id, platformName: pl.name, formatId: f.id, formatName: f.name, durationSec: durationSec ?? null };
  };
  const day = 86400_000;

  // 1. APPROVED with a certificate (Acme Clips → Jane). Tribute: Jane's base fee, USD 25.
  const approved = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: janeC.id,
      status: "APPROVED_IN_PRINCIPLE", // issueGrant below makes it APPROVED
      selections: [sel(yt, "Shorts", 25)],
      assetTypeIds: [at("Name"), at("Photo/picture")],
      assetTypeNames: ["Name", "Photo/picture"],
      context: "A 25-second YouTube Short celebrating Jane's award win, using one red-carpet photo.",
      creativePlan:
        "We open on the award announcement, show the red-carpet photo for ~4 seconds with a congratulatory voice-over, and end with a call to watch her acceptance speech. Intent is a tribute; tone is celebratory and respectful throughout the piece.",
      intentCategoryId: intent("Tribute").id,
      intentCategoryName: "Tribute",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 3 * day),
      decidedAt: new Date(Date.now() - 2 * day),
      decidedById: jane.id,
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "approved", actorName: "Jane Carter", actorSide: "consenter" },
        ],
      },
    },
  });
  await demoFile({ kind: "ASSET", name: "red-carpet-photo.txt", content: "DEMO ASSET — red carpet photo placeholder", requestId: approved.id, uploadedById: clipsOwner.id });
  await demoFile({ kind: "RAW_CONTENT", name: "short-final-cut.txt", content: "DEMO RAW CONTENT — final 25s short placeholder", requestId: approved.id, uploadedById: clipsOwner.id });
  await issueGrant(approved.id, "Jane Carter");
  await payForRequest({ requestId: approved.id, requesterId: clipsR.id, consenterId: janeC.id, fee: 25, currency: "USD", status: "APPROVED" });

  // 2. PENDING, free (Daily Lens → Jane). News is free to ask Jane.
  await db.consentRequest.create({
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
      slaExpiresAt: new Date(Date.now() + 7 * day),
      events: { create: [{ type: "submitted", actorSide: "requester" }] },
    },
  });

  // 3. PENDING, paid and held (Acme Clips → Nightwatch). USD 100 + USD 20 platform fee.
  const review = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: showC.id,
      status: "PENDING",
      selections: [sel(yt, "Long video", 45), sel(ig, "Reel", 30)],
      assetTypeIds: [at("Character/show footage"), at("Poster/still")],
      assetTypeNames: ["Character/show footage", "Poster/still"],
      thumbnailUsed: true,
      context: "Season 4 finale reaction video using three short scenes and the season poster.",
      creativePlan:
        "A 12-minute reaction and review of the Nightwatch season finale. Three scenes (15s each) are shown with pause-and-comment analysis, plus the poster in the thumbnail. Intent is review and commentary; spoilers flagged in the first 10 seconds.",
      intentCategoryId: intent("Review").id,
      intentCategoryName: "Review",
      validityKind: "DATE_RANGE",
      validFrom: new Date(),
      validUntil: new Date(Date.now() + 90 * day),
      submittedAt: new Date(Date.now() - day),
      slaExpiresAt: new Date(Date.now() + 6 * day),
      events: { create: [{ type: "submitted", actorSide: "requester" }] },
    },
  });
  await demoFile({ kind: "ASSET", name: "scene-list.txt", content: "DEMO ASSET — scene list placeholder", requestId: review.id, uploadedById: clipsOwner.id });
  await payForRequest({ requestId: review.id, requesterId: clipsR.id, consenterId: showC.id, fee: 100, currency: "USD", status: "PENDING" });

  // 4. CHANGES_REQUESTED: Nightwatch asked a question (Daily Lens → Nightwatch). USD 100, held.
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
      submittedAt: new Date(Date.now() - 2 * day),
      slaExpiresAt: new Date(Date.now() + 6 * day),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "changes_requested", actorName: "Nina Producer", actorSide: "consenter", detail: { note: "Can you trim the stunt sequence out of the behind-the-scenes reel? Then upload the new cut." } },
        ],
      },
    },
  });
  await payForRequest({ requestId: changes.id, requesterId: newsR.id, consenterId: showC.id, fee: 100, currency: "USD", status: "CHANGES_REQUESTED" });

  // 5. DENIED, free (Acme Clips → Volt)
  await db.consentRequest.create({
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
      submittedAt: new Date(Date.now() - 5 * day),
      decidedAt: new Date(Date.now() - 4 * day),
      decidedById: brandOwner.id,
      denialReason: "Does not fit my brand — We avoid stunt/parkour association for safety reasons.",
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "denied", actorName: "Victor Brand", actorSide: "consenter", detail: { reason: "Does not fit my brand" } },
        ],
      },
    },
  });

  // 6. EXPIRED_NO_RESPONSE, free (Daily Lens → Volt)
  await db.consentRequest.create({
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
      submittedAt: new Date(Date.now() - 12 * day),
      slaExpiresAt: new Date(Date.now() - 5 * day),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "auto_expired", actorSide: "system" },
        ],
      },
    },
  });

  // 7. The other direction: Jane asks Acme Clips (free to ask), waiting for their answer.
  await db.consentRequest.create({
    data: {
      requesterId: janeR.id,
      consenterId: clipsC.id,
      status: "PENDING",
      selections: [sel(ig, "Story", 15)],
      assetTypeIds: [at("Video reference/clip")],
      assetTypeNames: ["Video reference/clip"],
      context: "Reposting 15 seconds of Acme Clips' award-night recap in Jane's Instagram story.",
      creativePlan:
        "A single Instagram story thanking fans, using the first 15 seconds of Acme Clips' award-night recap with their handle tagged on screen. Intent is a thank-you to fans; no edits to the clip itself.",
      intentCategoryId: intent("Entertainment").id,
      intentCategoryName: "Entertainment",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 6 * 3600_000),
      slaExpiresAt: new Date(Date.now() + 7 * day - 6 * 3600_000),
      events: { create: [{ type: "submitted", actorName: "Jane Carter", actorSide: "requester" }] },
    },
  });

  // 8. WITHDRAWN (Acme Clips → Jane). USD 25 paid; 80% came back.
  const withdrawn = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id,
      consenterId: janeC.id,
      status: "WITHDRAWN",
      selections: [sel(ig, "Story", 10)],
      assetTypeIds: [at("Photo/picture")],
      assetTypeNames: ["Photo/picture"],
      context: "Story repost of a fan photo (withdrawn: we chose a different photo).",
      creativePlan:
        "A 10-second Instagram story reposting a public appearance photo with a positive caption tagging Jane. Intent was entertainment; we withdrew after choosing different content for the slot.",
      intentCategoryId: intent("Entertainment").id,
      intentCategoryName: "Entertainment",
      validityKind: "SINGLE_PUBLICATION",
      submittedAt: new Date(Date.now() - 6 * day),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "withdrawn", actorName: "Casey Clips", actorSide: "requester" },
        ],
      },
    },
  });
  await payForRequest({ requestId: withdrawn.id, requesterId: clipsR.id, consenterId: janeC.id, fee: 25, currency: "USD", status: "WITHDRAWN", endedBecause: "Request was withdrawn" });

  // Report (OPEN) on the approved request + takedown RAISED on its certificate
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
        respondBy: new Date(Date.now() + 7 * day),
      },
    });
  }

  // 9. DRAFT (Daily Lens → Nightwatch)
  await db.consentRequest.create({
    data: {
      requesterId: newsR.id, consenterId: showC.id, status: "DRAFT",
      selections: [sel(yt, "Shorts", 15)], assetTypeIds: [at("Poster/still")], assetTypeNames: ["Poster/still"],
      context: "", creativePlan: "", validityKind: "SINGLE_PUBLICATION",
    },
  });

  // 10. CLOSED: the question went unanswered for 7 days (Acme Clips → Nightwatch). USD 100; 80% came back.
  const closed = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id, consenterId: showC.id, status: "CLOSED",
      closedReason: "No answer to the question within 7 days",
      selections: [sel(yt, "Long video", 50)], assetTypeIds: [at("Character/show footage")], assetTypeNames: ["Character/show footage"],
      context: "Compilation of iconic Nightwatch moments across four seasons.",
      creativePlan: "A ten-minute ranked compilation of the show's most iconic scenes with commentary between clips. Intent is entertainment; every clip is under 20 seconds and the show is credited on screen throughout.",
      intentCategoryId: intent("Entertainment").id, intentCategoryName: "Entertainment",
      validityKind: "SINGLE_PUBLICATION", submittedAt: new Date(Date.now() - 16 * day),
      events: {
        create: [
          { type: "submitted", actorSide: "requester" },
          { type: "changes_requested", actorName: "Nina Producer", actorSide: "consenter", detail: { note: "Which seasons do the clips come from? Season 4 isn't available yet." } },
          { type: "auto_closed", actorSide: "system" },
        ],
      },
    },
  });
  await payForRequest({ requestId: closed.id, requesterId: clipsR.id, consenterId: showC.id, fee: 100, currency: "USD", status: "CLOSED", endedBecause: "Request was closed" });

  // 11. APPROVED_IN_PRINCIPLE: yes, waiting for the final file (Daily Lens → Jane). USD 25; Jane's 80% is released.
  const inPrinciple = await db.consentRequest.create({
    data: {
      requesterId: newsR.id, consenterId: janeC.id, status: "APPROVED_IN_PRINCIPLE",
      selections: [sel(yt, "Community post")], assetTypeIds: [at("Name")], assetTypeNames: ["Name"],
      context: "Community post announcing our interview special featuring Jane by name.",
      creativePlan: "A community post teaser naming Jane ahead of our interview special. Intent is promotion of a news program; final artwork is still in production, so approval in principle while we finish the asset.",
      intentCategoryId: intent("Promotion").id, intentCategoryName: "Promotion",
      validityKind: "SINGLE_PUBLICATION", submittedAt: new Date(Date.now() - 2 * day),
      decidedAt: new Date(Date.now() - day), decidedById: jane.id,
      events: { create: [{ type: "submitted", actorSide: "requester" }, { type: "approved", actorName: "Jane Carter", actorSide: "consenter" }] },
    },
  });
  await payForRequest({ requestId: inPrinciple.id, requesterId: newsR.id, consenterId: janeC.id, fee: 25, currency: "USD", status: "APPROVED_IN_PRINCIPLE" });

  // 12. PENDING at Jane's commentary fee (Acme Clips → Jane). USD 10 + USD 2 platform fee, held.
  const commentary = await db.consentRequest.create({
    data: {
      requesterId: clipsR.id, consenterId: janeC.id, status: "PENDING",
      selections: [sel(ig, "Reel", 20)], assetTypeIds: [at("Voice/audio clip")], assetTypeNames: ["Voice/audio clip"],
      context: "Reel using a 20-second clip of Jane's podcast audio over subtitled visuals.",
      creativePlan: "A 20-second reel pairing Jane's podcast quote with subtitled motion graphics. Intent is commentary on creator economics, with Jane credited on screen and in the caption.",
      intentCategoryId: intent("Commentary").id, intentCategoryName: "Commentary",
      validityKind: "DATE_RANGE", validFrom: new Date(), validUntil: new Date(Date.now() + 180 * day),
      submittedAt: new Date(Date.now() - day), slaExpiresAt: new Date(Date.now() + 6 * day),
      events: { create: [{ type: "submitted", actorSide: "requester" }] },
    },
  });
  await payForRequest({ requestId: commentary.id, requesterId: clipsR.id, consenterId: janeC.id, fee: 10, currency: "USD", status: "PENDING" });

  console.log("Demo data ready. Logins (password: Password1!; every account sets up 2FA at first sign-in):");
  console.log("  admin@consent.app — Super Admin");
  console.log("  jane@demo.consent — Jane Carter (person; USD 25 fee, news free)");
  console.log("  show@demo.consent — Nightwatch (TV series; USD 100 fee)");
  console.log("  brand@demo.consent — Volt Energy (brand; free to ask)");
  console.log("  clips@demo.consent — Acme Clips (creator; free to ask)");
  console.log("  news@demo.consent — Daily Lens News (news channel; free to ask)");
  console.log("  pod@demo.consent — Night Owls Podcast (ID check waiting)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
