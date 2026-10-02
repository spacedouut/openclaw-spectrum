import { afterEach, describe, expect, it } from "vitest";
import {
  registerRunningSpectrumAccount,
  rememberSpectrumSpace,
  unregisterRunningSpectrumAccount,
  type RunningSpectrumAccount,
} from "../src/registry.js";
import { deliverToSpectrumSpace, sendSpectrumMessage } from "../src/send.js";
import type { CoreConfig } from "../src/types.js";
import { createFakeApp, createFakeSpace } from "./fakes.js";

const cfg: CoreConfig = { channels: { spectrum: { providers: { telegram: true } } } };

describe("deliverToSpectrumSpace", () => {
  it("sends markdown text by default and plain text when disabled", async () => {
    const { space, sent } = createFakeSpace("42");
    await deliverToSpectrumSpace({ space, text: "**hi**", options: { markdown: true } });
    await deliverToSpectrumSpace({ space, text: "plain", options: { markdown: false } });
    expect(sent).toEqual([
      { type: "markdown", markdown: "**hi**" },
      { type: "text", text: "plain" },
    ]);
  });

  it("sends text before loaded attachments", async () => {
    const { space, sent } = createFakeSpace("42");
    const result = await deliverToSpectrumSpace({
      space,
      text: "caption",
      mediaUrls: ["/tmp/spectrum-test/pic.png"],
      options: {
        markdown: false,
        mediaLocalRoots: ["/tmp/spectrum-test"],
        mediaReadFile: async () => Buffer.from("not really a png"),
      },
    });
    expect(sent.map((item) => item.type)).toEqual(["text", "attachment"]);
    expect(sent[1]).toMatchObject({ name: "pic.png" });
    expect(result.messageId).toBe("out-2");
  });

  it("does nothing for empty payloads", async () => {
    const { space, sent } = createFakeSpace("42");
    expect(await deliverToSpectrumSpace({ space, text: "  ", options: { markdown: true } })).toEqual(
      { messageId: undefined },
    );
    expect(sent).toEqual([]);
  });
});

describe("sendSpectrumMessage", () => {
  let entry: RunningSpectrumAccount | undefined;
  afterEach(() => {
    if (entry) unregisterRunningSpectrumAccount(entry);
    entry = undefined;
  });

  it("delivers to a cached space for a running account", async () => {
    const { app } = createFakeApp();
    entry = { accountId: "default", app, platforms: new Set(["telegram"]), spaces: new Map() };
    registerRunningSpectrumAccount(entry);
    const { space, sent } = createFakeSpace("-100123");
    rememberSpectrumSpace(entry, "telegram", space);
    const result = await sendSpectrumMessage({ cfg, to: "tg:-100123", text: "hello" });
    expect(result).toEqual({ to: "telegram:-100123", messageId: "out-1" });
    expect(sent).toEqual([{ type: "markdown", markdown: "hello" }]);
  });

  it("rejects invalid targets, stopped accounts, and disabled providers", async () => {
    await expect(sendSpectrumMessage({ cfg, to: "nope", text: "x" })).rejects.toThrow(
      /Invalid Spectrum target/,
    );
    await expect(sendSpectrumMessage({ cfg, to: "telegram:1", text: "x" })).rejects.toThrow(
      /not running/,
    );
    const { app } = createFakeApp();
    entry = { accountId: "default", app, platforms: new Set(["telegram"]), spaces: new Map() };
    registerRunningSpectrumAccount(entry);
    await expect(sendSpectrumMessage({ cfg, to: "imessage:+1555", text: "x" })).rejects.toThrow(
      /not enabled/,
    );
  });
});
