import { describe, expect, it } from "vitest";
import { DEFAULT_CURRENCIES } from "../../../lib/currency-rules";
import { channelHandle, echoValues, readApplication, readChannels, readReceiveLimit } from "./application";

const apply = (fd: FormData) => readApplication(fd, DEFAULT_CURRENCIES);

const photo = () => new File(["img"], "me.jpg", { type: "image/jpeg" });
const doc = () => new File(["pdf"], "id.pdf", { type: "application/pdf" });

function form(overrides: Record<string, string | File | null> = {}, channels?: [string, string, string][]) {
  const base: Record<string, string | File | null> = {
    entityType: "PERSON",
    creatorType: "INDIVIDUAL_CREATOR",
    country: "IN",
    legalName: "Jane Carter",
    displayName: "Jane Carter",
    aliases: "",
    category: "Actor",
    bio: "Actor and producer, known for Nightwatch and a lot of stage work.",
    photo: photo(),
    documentType: "Passport",
    documentNumber: "P1234567",
    document: doc(),
    consentPriceCurrency: "INR",
    feeMode: "free",
    limitKind: "unlimited",
    declaration: "on",
    ...overrides,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(base)) if (v !== null) f.set(k, v);
  for (const [p, u, n] of channels ?? [["YouTube", "https://youtube.com/@jane", "1200"]]) {
    f.append("channelPlatform", p);
    f.append("channelUrl", u);
    f.append("channelFollowers", n);
  }
  return f;
}

describe("readApplication", () => {
  it("takes a complete application", () => {
    const r = apply(form({ aliases: "JC, Janey, JC" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.entityType).toBe("PERSON");
    expect(r.data.aliases).toEqual(["JC", "Janey"]);
    expect(r.data.channels).toEqual([{ platform: "YouTube", url: "https://youtube.com/@jane", followers: 1200 }]);
    expect(r.data.consentPrice).toBeNull();
    expect(r.data.consentPriceCurrency).toBe("INR");
    expect(r.data.limits).toEqual({
      maxOpenRequests: null,
      dailyRequestLimit: null,
      weeklyRequestLimit: null,
      monthlyRequestLimit: null,
    });
  });

  it("needs an explicit fee choice: Free, or a fee of at least the currency's minimum", () => {
    expect(apply(form({ feeMode: null }))).toEqual({ ok: false, error: "Choose Free or a fee for your consent request fee." });
    expect(apply(form({ consentPriceCurrency: "XYZ" }))).toMatchObject({ ok: false, error: expect.stringMatching(/currency/) });
    const low = apply(form({ feeMode: "paid", consentPrice: "99" }));
    expect(low).toMatchObject({ ok: false, error: expect.stringMatching(/at least ₹100\.00, or choose Free/) });
    expect(apply(form({ feeMode: "paid", consentPrice: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/or choose Free/) });
    const paid = apply(form({ feeMode: "paid", consentPrice: "149.5" }));
    expect(paid).toMatchObject({ ok: true, data: { consentPrice: 149.5, consentPriceCurrency: "INR" } });
    const usd = apply(form({ feeMode: "paid", consentPrice: "1.20", consentPriceCurrency: "USD" }));
    expect(usd).toMatchObject({ ok: true, data: { consentPrice: 1.2, consentPriceCurrency: "USD" } });
    // Free ignores a stray amount.
    expect(apply(form({ feeMode: "free", consentPrice: "500" }))).toMatchObject({ ok: true, data: { consentPrice: null } });
  });

  it("needs an explicit receive limit: Unlimited, or 1 or more per day, week or month", () => {
    expect(apply(form({ limitKind: null }))).toEqual({ ok: false, error: "Choose how many requests you can receive." });
    expect(apply(form({ limitKind: "day", limitCount: "0" }))).toMatchObject({ ok: false, error: expect.stringMatching(/per day: a whole number from 1/) });
    expect(apply(form({ limitKind: "week", limitCount: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/per week/) });
    expect(apply(form({ limitKind: "month", limitCount: "2.5" }))).toMatchObject({ ok: false });
    expect(apply(form({ limitKind: "month", limitCount: "10001" }))).toMatchObject({ ok: false });
    const weekly = apply(form({ limitKind: "week", limitCount: "15" }));
    expect(weekly).toMatchObject({
      ok: true,
      data: { limits: { maxOpenRequests: null, dailyRequestLimit: null, weeklyRequestLimit: 15, monthlyRequestLimit: null } },
    });
  });

  it("needs every field except 'Also known as', naming the missing one", () => {
    const cases: [Record<string, string | File | null>, RegExp][] = [
      [{ entityType: "" }, /kind of profile/],
      [{ creatorType: "" }, /creator type/],
      [{ country: "" }, /country/],
      [{ country: "ZZ" }, /country/],
      [{ legalName: " " }, /legal name/],
      [{ displayName: "" }, /display name/],
      [{ category: "" }, /what you do/i],
      [{ bio: "Too short." }, /40 characters/],
      [{ photo: null }, /profile photo/],
      [{ photo: doc() }, /photo must be an image/],
      [{ documentType: "" }, /type of ID document/],
      [{ documentNumber: "" }, /ID document number/],
      [{ document: null }, /Upload your ID document/],
      [{ document: new File(["x"], "id.zip", { type: "application/zip" }) }, /PDF or an image/],
      [{ declaration: null }, /Tick the box/],
    ];
    for (const [o, msg] of cases) {
      const r = apply(form(o));
      expect(r.ok, JSON.stringify(Object.keys(o))).toBe(false);
      if (!r.ok) expect(r.error).toMatch(msg);
    }
  });

  it("treats an empty file input as missing", () => {
    const r = apply(form({ photo: new File([], "", { type: "application/octet-stream" }) }));
    expect(r).toEqual({ ok: false, error: "Add a profile photo." });
  });
});

describe("readChannels", () => {
  const read = (rows: [string, string, string][]) => readChannels(form({}, rows));

  it("needs at least one complete channel", () => {
    expect(read([["", "", ""]])).toMatchObject({ ok: false, error: expect.stringMatching(/at least one channel/) });
  });

  it("skips empty rows but rejects half-filled ones", () => {
    expect(read([["YouTube", "youtube.com/@jane", "0"], ["", "", ""]])).toEqual({
      ok: true,
      channels: [{ platform: "YouTube", url: "https://youtube.com/@jane", followers: 0 }],
    });
    expect(read([["YouTube", "https://youtube.com/@jane", "5"], ["Instagram", "", ""]])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Channel 2: add the link/),
    });
    expect(read([["YouTube", "https://youtube.com/@jane", ""]])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Channel 1: add the follower count/),
    });
    expect(read([["", "https://youtube.com/@jane", "5"]])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Channel 1: add the platform/),
    });
  });

  it("only takes web links and whole follower counts", () => {
    expect(read([["X", "javascript:alert(1)", "5"]])).toMatchObject({ ok: false, error: expect.stringMatching(/web address/) });
    expect(read([["X", "https://x.com/jane", "-3"]])).toMatchObject({ ok: false, error: expect.stringMatching(/follower count/) });
    expect(read([["X", "https://x.com/jane", "1,200"]])).toMatchObject({ ok: true, channels: [{ followers: 1200 }] });
  });

  it("takes up to six channels, each link once", () => {
    const row = (i: number): [string, string, string] => ["Web", `https://example.com/${i}`, "1"];
    expect(read([1, 2, 3, 4, 5, 6].map(row))).toMatchObject({ ok: true });
    expect(read([1, 2, 3, 4, 5, 6, 7].map(row))).toMatchObject({ ok: false, error: "Add up to 6 channels." });
    expect(read([row(1), row(1)])).toMatchObject({ ok: false, error: expect.stringMatching(/once/) });
  });
});

describe("readReceiveLimit", () => {
  it("sets only the chosen limit", () => {
    const fd = new FormData();
    fd.set("limitKind", "day");
    fd.set("limitCount", "3");
    expect(readReceiveLimit(fd)).toEqual({
      ok: true,
      limits: { maxOpenRequests: null, dailyRequestLimit: 3, weeklyRequestLimit: null, monthlyRequestLimit: null },
    });
  });
});

describe("echoValues", () => {
  it("keeps what was typed (not files) to fill the form in again", () => {
    const v = echoValues(form({ legalName: "  Jane  ", feeMode: "paid", consentPrice: "99", limitKind: "week", limitCount: "5" }));
    expect(v.legalName).toBe("Jane");
    expect(v).toMatchObject({ feeMode: "paid", consentPrice: "99", consentPriceCurrency: "INR", limitKind: "week", limitCount: "5" });
    expect(v).not.toHaveProperty("photo");
  });

  it("keeps channel rows in their places, so an error's row number still matches", () => {
    const rows: [string, string, string][] = [
      ["YouTube", "https://youtube.com/@jane", "9"],
      ["", "", ""],
      ["Instagram", "", "40"],
    ];
    expect(echoValues(form({}, rows)).channels).toEqual([
      { platform: "YouTube", url: "https://youtube.com/@jane", followers: "9" },
      { platform: "", url: "", followers: "" },
      { platform: "Instagram", url: "", followers: "40" },
    ]);
    expect(readChannels(form({}, rows))).toMatchObject({ ok: false, error: expect.stringMatching(/^Channel 3: add the link/) });
  });
});

describe("channelHandle", () => {
  it("drops the scheme, www and a trailing slash", () => {
    expect(channelHandle("https://www.youtube.com/@jane/")).toBe("youtube.com/@jane");
  });
});
