/* The one onboarding form, read and checked. Every profile goes through the
   same ID check, and every field is required except "Also known as": an
   incomplete profile never reaches the review queue. Pure (no database), so
   it can be unit-tested and shared with the form. */

import type { ConsenterEntityType, RequesterType } from "@prisma/client";
import { safeChannelUrl } from "../../../lib/channels";
import { COUNTRIES } from "../../../lib/countries";
import type { CurrencyRule } from "../../../lib/currency-rules";
import type { Limits } from "../../../lib/capacity";
import { readFeeForm } from "../c-panel/settings/fee-form";
import { MAX_LIMIT } from "../c-panel/settings/limits";

export const ENTITY_TYPES: { value: ConsenterEntityType; label: string }[] = [
  { value: "PERSON", label: "Person" },
  { value: "BRAND", label: "Brand" },
  { value: "TV_SHOW", label: "TV show" },
  { value: "MOVIE", label: "Movie" },
  { value: "WEB_SERIES", label: "Web series" },
  { value: "FICTIONAL_CHARACTER", label: "Fictional character" },
  { value: "BAND_GROUP", label: "Band or group" },
  { value: "SPORTS_TEAM", label: "Sports team" },
  { value: "OTHER", label: "Other" },
];

export const CREATOR_TYPES: { value: RequesterType; label: string }[] = [
  { value: "INDIVIDUAL_CREATOR", label: "Individual creator" },
  { value: "NEWS_CHANNEL", label: "News channel" },
  { value: "PODCAST", label: "Podcast" },
  { value: "MEME_PAGE", label: "Meme page" },
  { value: "MEDIA_HOUSE", label: "Media house" },
  { value: "AGENCY", label: "Agency" },
  { value: "OTHER", label: "Other" },
];

export const DOCUMENT_TYPES = [
  "Passport",
  "National ID card",
  "Driving licence",
  "Voter ID",
  "Business registration",
  "Trademark certificate",
  "Letter of authorisation",
  "Other",
] as const;

/** How many requests a profile can receive: no limit, or a number per day, week or month. */
export const LIMIT_KINDS = [
  { value: "unlimited", label: "Unlimited" },
  { value: "day", label: "Per day" },
  { value: "week", label: "Per week" },
  { value: "month", label: "Per month" },
] as const;
export type LimitKind = (typeof LIMIT_KINDS)[number]["value"];

export const MAX_CHANNELS = 6;
export const MIN_BIO = 40;

export function entityLabel(v: string): string {
  return ENTITY_TYPES.find((t) => t.value === v)?.label ?? "Other";
}

export function creatorLabel(v: string): string {
  return CREATOR_TYPES.find((t) => t.value === v)?.label ?? "Other";
}

export type ChannelInput = { platform: string; url: string; followers: number };

/** What the person typed, to fill the form in again after an error. */
export type ApplicationValues = {
  entityType: string;
  creatorType: string;
  country: string;
  legalName: string;
  displayName: string;
  aliases: string;
  category: string;
  bio: string;
  documentType: string;
  documentNumber: string;
  channels: { platform: string; url: string; followers: string }[];
  /** "free", "paid", or "" before a choice. */
  feeMode: string;
  consentPrice: string;
  /** "" = follow the country. */
  consentPriceCurrency: string;
  /** A LimitKind, or "" before a choice. */
  limitKind: string;
  limitCount: string;
};

export type ApplicationState = {
  error: string | null;
  values: ApplicationValues;
  /** Bumped on every answer from the server, so the form remounts with these values. */
  attempt: number;
};

export const EMPTY_VALUES: ApplicationValues = {
  entityType: "",
  creatorType: "",
  country: "",
  legalName: "",
  displayName: "",
  aliases: "",
  category: "",
  bio: "",
  documentType: "",
  documentNumber: "",
  channels: [],
  feeMode: "",
  consentPrice: "",
  consentPriceCurrency: "",
  limitKind: "",
  limitCount: "",
};

export type Application = {
  entityType: ConsenterEntityType;
  creatorType: RequesterType;
  country: string;
  legalName: string;
  displayName: string;
  aliases: string[];
  category: string;
  bio: string;
  documentType: string;
  documentNumber: string;
  channels: ChannelInput[];
  /** null = free to ask. */
  consentPrice: number | null;
  consentPriceCurrency: string;
  limits: Limits;
  photo: File;
  document: File;
};

const text = (fd: FormData, name: string) => String(fd.get(name) ?? "").trim();

/** An uploaded file, or null when the field was left empty. */
function fileOf(fd: FormData, name: string): File | null {
  const v = fd.get(name);
  if (!v || typeof v === "string") return null;
  return v.size > 0 ? v : null;
}

const isImage = (f: File) => (f.type || "").startsWith("image/");
const isPdfOrImage = (f: File) => isImage(f) || f.type === "application/pdf";

/** The typed values, for refilling the form. Files can't be refilled. */
export function echoValues(fd: FormData): ApplicationValues {
  const platforms = fd.getAll("channelPlatform").map(String);
  const urls = fd.getAll("channelUrl").map(String);
  const followers = fd.getAll("channelFollowers").map(String);
  const rows = Math.min(MAX_CHANNELS, Math.max(platforms.length, urls.length, followers.length));
  return {
    entityType: text(fd, "entityType"),
    creatorType: text(fd, "creatorType"),
    country: text(fd, "country"),
    legalName: text(fd, "legalName"),
    displayName: text(fd, "displayName"),
    aliases: text(fd, "aliases"),
    category: text(fd, "category"),
    bio: text(fd, "bio"),
    documentType: text(fd, "documentType"),
    documentNumber: text(fd, "documentNumber"),
    // Rows keep their places, so "Channel 3: …" still points at the third row.
    channels: Array.from({ length: rows }, (_, i) => ({
      platform: (platforms[i] ?? "").trim(),
      url: (urls[i] ?? "").trim(),
      followers: (followers[i] ?? "").trim(),
    })),
    feeMode: text(fd, "feeMode"),
    consentPrice: text(fd, "consentPrice"),
    consentPriceCurrency: text(fd, "consentPriceCurrency"),
    limitKind: text(fd, "limitKind"),
    limitCount: text(fd, "limitCount"),
  };
}

/**
 * How many requests the profile can receive: one explicit choice, Unlimited
 * or a whole number per day, week or month. Only the chosen limit is set.
 */
export function readReceiveLimit(fd: FormData): { ok: true; limits: Limits } | { ok: false; error: string } {
  const kind = text(fd, "limitKind");
  const limits: Limits = { maxOpenRequests: null, dailyRequestLimit: null, weeklyRequestLimit: null, monthlyRequestLimit: null };
  if (kind === "unlimited") return { ok: true, limits };
  if (kind !== "day" && kind !== "week" && kind !== "month")
    return { ok: false, error: "Choose how many requests you can receive." };
  const raw = text(fd, "limitCount");
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < 1 || n > MAX_LIMIT)
    return {
      ok: false,
      error: `Enter how many requests you can receive ${kind === "day" ? "per day" : kind === "week" ? "per week" : "per month"}: a whole number from 1 to ${MAX_LIMIT.toLocaleString("en-US")}.`,
    };
  if (kind === "day") limits.dailyRequestLimit = n;
  else if (kind === "week") limits.weeklyRequestLimit = n;
  else limits.monthlyRequestLimit = n;
  return { ok: true, limits };
}

/** The channel rows: each started row must be complete, and at least one is needed. */
export function readChannels(fd: FormData): { ok: true; channels: ChannelInput[] } | { ok: false; error: string } {
  const platforms = fd.getAll("channelPlatform").map(String);
  const urls = fd.getAll("channelUrl").map(String);
  const followers = fd.getAll("channelFollowers").map(String);
  const rows = Math.max(platforms.length, urls.length, followers.length);
  const channels: ChannelInput[] = [];
  for (let i = 0; i < rows; i++) {
    const platform = (platforms[i] ?? "").trim();
    const rawUrl = (urls[i] ?? "").trim();
    const rawFollowers = (followers[i] ?? "").trim();
    if (!platform && !rawUrl && !rawFollowers) continue;
    const n = `Channel ${i + 1}`;
    if (!platform) return { ok: false, error: `${n}: add the platform, like YouTube or Instagram.` };
    if (platform.length > 40) return { ok: false, error: `${n}: keep the platform name short.` };
    if (!rawUrl) return { ok: false, error: `${n}: add the link to the channel.` };
    const url = safeChannelUrl(rawUrl);
    if (!url) return { ok: false, error: `${n}: the link must be a web address, like https://youtube.com/@you.` };
    if (!/^\d{1,12}$/.test(rawFollowers.replace(/[,\s]/g, "")))
      return { ok: false, error: `${n}: add the follower count (a whole number, 0 or more).` };
    channels.push({ platform, url, followers: parseInt(rawFollowers.replace(/[,\s]/g, ""), 10) });
  }
  if (channels.length === 0)
    return { ok: false, error: "Add at least one channel: the platform, the link and the follower count." };
  if (channels.length > MAX_CHANNELS) return { ok: false, error: `Add up to ${MAX_CHANNELS} channels.` };
  if (new Set(channels.map((c) => c.url)).size !== channels.length)
    return { ok: false, error: "Each channel link can be added once." };
  return { ok: true, channels };
}

/**
 * The whole application, or the first problem in form order, written as a
 * plain sentence that names the missing field.
 */
export function readApplication(
  fd: FormData,
  currencies: CurrencyRule[],
): { ok: true; data: Application } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });

  const entityType = text(fd, "entityType");
  if (!ENTITY_TYPES.some((t) => t.value === entityType)) return fail("Choose the kind of profile.");
  const creatorType = text(fd, "creatorType");
  if (!CREATOR_TYPES.some((t) => t.value === creatorType)) return fail("Choose your creator type.");
  const country = text(fd, "country");
  if (!COUNTRIES.some(([code]) => code === country)) return fail("Choose your country.");

  const legalName = text(fd, "legalName");
  if (legalName.length < 2) return fail("Add your legal name.");
  if (legalName.length > 200) return fail("Keep the legal name under 200 characters.");
  const displayName = text(fd, "displayName");
  if (displayName.length < 2) return fail("Add your public display name.");
  if (displayName.length > 100) return fail("Keep the public display name under 100 characters.");
  const aliasesRaw = text(fd, "aliases");
  if (aliasesRaw.length > 500) return fail("Keep “Also known as” under 500 characters.");
  const aliases = [...new Set(aliasesRaw.split(",").map((a) => a.trim()).filter(Boolean))].slice(0, 20);

  const category = text(fd, "category");
  if (category.length < 2) return fail("Say what you do, like actor, news channel or clothing brand.");
  if (category.length > 100) return fail("Keep “What you do” under 100 characters.");
  const bio = text(fd, "bio");
  if (bio.length < MIN_BIO) return fail(`Write at least ${MIN_BIO} characters in “About you”.`);
  if (bio.length > 2000) return fail("Keep “About you” under 2,000 characters.");

  const photo = fileOf(fd, "photo");
  if (!photo) return fail("Add a profile photo.");
  if (!isImage(photo)) return fail("The profile photo must be an image.");

  const channels = readChannels(fd);
  if (!channels.ok) return channels;

  const fee = readFeeForm(fd, currencies, []);
  if (!fee.ok) return fee;
  const limit = readReceiveLimit(fd);
  if (!limit.ok) return limit;

  const documentType = text(fd, "documentType");
  if (!(DOCUMENT_TYPES as readonly string[]).includes(documentType)) return fail("Choose the type of ID document.");
  const documentNumber = text(fd, "documentNumber");
  if (documentNumber.length < 3) return fail("Add the ID document number.");
  if (documentNumber.length > 100) return fail("Keep the ID document number under 100 characters.");
  const document = fileOf(fd, "document");
  if (!document) return fail("Upload your ID document.");
  if (!isPdfOrImage(document)) return fail("Upload the ID document as a PDF or an image.");

  if (fd.get("declaration") !== "on")
    return fail("Tick the box to confirm this is you, or that you are authorised to represent this name.");

  return {
    ok: true,
    data: {
      entityType: entityType as ConsenterEntityType,
      creatorType: creatorType as RequesterType,
      country,
      legalName,
      displayName,
      aliases,
      category,
      bio,
      documentType,
      documentNumber,
      channels: channels.channels,
      consentPrice: fee.fee.consentPrice,
      consentPriceCurrency: fee.fee.currency,
      limits: limit.limits,
      photo,
      document,
    },
  };
}

/** A channel's handle as stored and matched for duplicates: the link without its scheme. */
export function channelHandle(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").slice(0, 120);
}
