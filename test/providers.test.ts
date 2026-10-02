import { describe, expect, it } from "vitest";
import { buildSpectrumProviders } from "../src/providers.js";

describe("buildSpectrumProviders", () => {
  it("creates a Spectrum provider config per enabled provider", () => {
    const configs = buildSpectrumProviders({
      imessage: {},
      telegram: { botToken: "tok" },
    });
    expect(configs.map((config) => config.__name)).toEqual(["imessage", "telegram"]);
    expect(configs.every((config) => config.__tag === "PlatformProviderConfig")).toBe(true);
  });

  it("returns an empty list when nothing is enabled", () => {
    expect(buildSpectrumProviders({})).toEqual([]);
  });
});
