import { describe, it, expect } from "vitest";
import { safeChannelUrl, channelKind, compactCount, parseChannels } from "../channels";

describe("safeChannelUrl", () => {
  it("keeps http(s) links and adds https:// to bare addresses", () => {
    expect(safeChannelUrl("https://youtube.com/@acme")).toBe("https://youtube.com/@acme");
    expect(safeChannelUrl("youtube.com/@acme")).toBe("https://youtube.com/@acme");
    expect(safeChannelUrl("  www.instagram.com/acme ")).toBe("https://www.instagram.com/acme");
  });
  it("rejects anything that isn't a web address", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,hi", "mailto:a@b.c", "", "acme", "https://user:pw@x.com/a", "ftp://x.com"]) {
      expect(safeChannelUrl(bad)).toBeNull();
    }
  });
});

describe("channelKind", () => {
  it("recognises the platform from the link first, then the typed name", () => {
    expect(channelKind("YouTube", "https://youtu.be/abc")).toBe("youtube");
    expect(channelKind("Twitter", "https://twitter.com/acme")).toBe("x");
    expect(channelKind("X (Twitter)", "https://x.com/acme")).toBe("x");
    expect(channelKind("Instagram", "https://www.instagram.com/acme")).toBe("instagram");
    expect(channelKind("LinkedIn", "https://linkedin.com/company/acme")).toBe("linkedin");
    expect(channelKind("Facebook", "https://m.facebook.com/acme")).toBe("facebook");
    expect(channelKind("Spotify", "https://open.spotify.com/show/x")).toBe("spotify");
    expect(channelKind("TikTok", "https://acme.example/tiktok")).toBe("tiktok");
    expect(channelKind("Blog", "https://acme.example")).toBe("web");
  });
  it("does not trust look-alike hosts", () => {
    expect(channelKind("Blog", "https://notyoutube.com/x")).toBe("web");
    expect(channelKind("Blog", "https://youtube.com.evil.example/x")).toBe("web");
  });
});

describe("compactCount", () => {
  it("formats follower counts", () => {
    expect(compactCount(220000)).toBe("220K");
    expect(compactCount(1800000)).toBe("1.8M");
    expect(compactCount(0)).toBe("");
    expect(compactCount(null)).toBe("");
  });
});

describe("parseChannels", () => {
  it("drops malformed entries and unsafe links", () => {
    const out = parseChannels([
      { platform: "YouTube", url: "https://youtube.com/@a", followers: 10 },
      { platform: "Evil", url: "javascript:alert(1)" },
      null,
      "nope",
      { platform: "Site", url: "acme.example" },
    ]);
    expect(out.map((c) => [c.kind, c.href])).toEqual([
      ["youtube", "https://youtube.com/@a"],
      ["web", "https://acme.example/"],
    ]);
    expect(parseChannels(null)).toEqual([]);
  });
});
