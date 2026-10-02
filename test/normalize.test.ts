import { describe, expect, it } from "vitest";
import type { Message } from "spectrum-ts";
import { normalizeSpectrumContent } from "../src/normalize.js";

type Content = Message["content"];

describe("normalizeSpectrumContent", () => {
  it("returns text and markdown bodies", () => {
    expect(normalizeSpectrumContent({ type: "text", text: " hi " })).toEqual({
      text: "hi",
      attachments: [],
    });
    expect(normalizeSpectrumContent({ type: "markdown", markdown: "**b**" })?.text).toBe("**b**");
  });

  it("collects attachments with lazy readers", async () => {
    const read = async () => Buffer.from("png");
    const content = {
      type: "attachment",
      name: "a.png",
      mimeType: "image/png",
      size: 3,
      read,
    } as Content;
    const normalized = normalizeSpectrumContent(content);
    expect(normalized?.text).toBe("");
    expect(normalized?.attachments).toHaveLength(1);
    expect(await normalized?.attachments[0]?.read()).toEqual(Buffer.from("png"));
  });

  it("ignores control events and empty content", () => {
    expect(normalizeSpectrumContent({ type: "typing", state: "start" } as Content)).toBeNull();
    expect(normalizeSpectrumContent({ type: "text", text: "   " })).toBeNull();
  });

  it("unwraps replies and describes rich links", () => {
    expect(
      normalizeSpectrumContent({
        type: "reply",
        content: { type: "text", text: "quoted reply" },
      } as Content)?.text,
    ).toBe("quoted reply");
    expect(
      normalizeSpectrumContent({ type: "richlink", url: "https://example.com" } as Content)?.text,
    ).toBe("https://example.com");
  });
});
