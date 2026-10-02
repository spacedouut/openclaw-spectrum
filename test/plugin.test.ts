import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { spectrumPlugin } from "../src/channel.js";
import { spectrumChannelConfigSchema } from "../src/config-schema.js";
import entry from "../src/index.js";
import setupEntry from "../src/setup-entry.js";

describe("plugin entry", () => {
  it("registers the spectrum channel", () => {
    expect(entry.id).toBe("spectrum");
    expect(entry.channelPlugin).toBe(spectrumPlugin);
    expect(setupEntry.plugin.id).toBe("spectrum");
    expect(setupEntry.plugin.setupWizard).toBe(spectrumPlugin.setupWizard);
    expect(setupEntry.plugin.setupContract).toBe(spectrumPlugin.setupContract);
    expect(spectrumPlugin.id).toBe("spectrum");
    expect(spectrumPlugin.capabilities.chatTypes).toEqual(["direct", "group"]);
  });

  it("normalizes messaging targets", () => {
    expect(spectrumPlugin.messaging?.normalizeTarget?.("tg:-100123")).toBe("telegram:-100123");
  });

  it("keeps the manifest channel schema in sync with the zod schema", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
    );
    const { $schema: _ignored, ...schema } = spectrumChannelConfigSchema.schema as Record<
      string,
      unknown
    >;
    expect(manifest.id).toBe("spectrum");
    expect(manifest.channels).toEqual(["spectrum"]);
    expect(manifest.channelConfigs.spectrum.schema).toEqual(schema);
  });

  it("publishes the setup contract fields in package metadata", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.openclaw.channel.setup.fields).toEqual(spectrumPlugin.setupContract?.metadata.fields);
    expect(pkg.openclaw.setupFeatures.configPromotion).toBe(
      spectrumPlugin.setupContract?.configPromotion,
    );
  });

  it("validates channel config", () => {
    const runtime = spectrumChannelConfigSchema.runtime;
    expect(runtime?.safeParse({ providers: { imessage: true } }).success).toBe(true);
    expect(runtime?.safeParse({ providers: { discord: true } }).success).toBe(false);
    expect(runtime?.safeParse({ dmPolicy: "open", providers: { imessage: true } }).success).toBe(
      false,
    );
  });
});
