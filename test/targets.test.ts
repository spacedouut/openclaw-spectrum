import { describe, expect, it } from "vitest";
import {
  formatSpectrumTarget,
  inferSpectrumTargetChatType,
  normalizeSpectrumSenderKey,
  normalizeSpectrumTarget,
  parseSpectrumTarget,
} from "../src/targets.js";

describe("spectrum targets", () => {
  it("parses platform-prefixed space and user targets", () => {
    expect(parseSpectrumTarget("imessage:any;-;+15551112222")).toEqual({
      platform: "imessage",
      kind: "space",
      id: "any;-;+15551112222",
    });
    expect(parseSpectrumTarget("spectrum:tg:user:42")).toEqual({
      platform: "telegram",
      kind: "user",
      id: "42",
    });
    expect(parseSpectrumTarget("WhatsApp:space:15551112222")).toEqual({
      platform: "whatsapp_business",
      kind: "space",
      id: "15551112222",
    });
  });

  it("rejects unknown platforms and empty ids", () => {
    expect(parseSpectrumTarget("discord:123")).toBeNull();
    expect(parseSpectrumTarget("telegram:")).toBeNull();
    expect(parseSpectrumTarget("12345")).toBeNull();
  });

  it("round-trips normalized targets", () => {
    expect(normalizeSpectrumTarget("tg:-100123")).toBe("telegram:-100123");
    expect(formatSpectrumTarget({ platform: "imessage", kind: "user", id: "+1555" })).toBe(
      "imessage:user:+1555",
    );
  });

  it("normalizes sender allowlist entries", () => {
    expect(normalizeSpectrumSenderKey("tg:user:42")).toBe("telegram:42");
    expect(normalizeSpectrumSenderKey("imessage:+15551112222")).toBe("imessage:+15551112222");
    expect(normalizeSpectrumSenderKey("*")).toBe("*");
    expect(normalizeSpectrumSenderKey("nope")).toBeUndefined();
  });

  it("infers chat types from provider id conventions", () => {
    expect(inferSpectrumTargetChatType({ platform: "telegram", kind: "space", id: "-100" })).toBe("group");
    expect(inferSpectrumTargetChatType({ platform: "telegram", kind: "space", id: "42" })).toBe("direct");
    expect(inferSpectrumTargetChatType({ platform: "imessage", kind: "space", id: "any;+;chat1" })).toBe("group");
    expect(inferSpectrumTargetChatType({ platform: "slack", kind: "space", id: "C123" })).toBe("group");
    expect(inferSpectrumTargetChatType({ platform: "slack", kind: "user", id: "U1" })).toBe("direct");
  });
});
