import { describe, it, expect } from "vitest";
import { generateKeyPairSync, sign as edSign } from "crypto";
import { canonicalJson, verifyPayload } from "../signing";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(
      '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}'
    );
  });
  it("is stable regardless of insertion order", () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe("verifyPayload", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const payload = { certificateId: "CERT-TEST", files: [{ sha256: "abc" }] };
  const signature = edSign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64");

  it("verifies a valid signature", () => {
    expect(verifyPayload(payload, signature, publicKeyPem)).toBe(true);
  });
  it("rejects a tampered payload", () => {
    expect(verifyPayload({ ...payload, certificateId: "CERT-EVIL" }, signature, publicKeyPem)).toBe(false);
  });
  it("rejects a malformed signature without throwing", () => {
    expect(verifyPayload(payload, "not-base64!!", publicKeyPem)).toBe(false);
  });
});
