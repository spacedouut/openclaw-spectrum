import { describe, expect, it } from "vitest";
import {
  listEnabledPlatforms,
  listSpectrumAccountIds,
  resolveDefaultSpectrumAccountId,
  resolveSpectrumAccount,
  resolveSpectrumProviders,
} from "../src/accounts.js";
import type { CoreConfig } from "../src/types.js";

describe("resolveSpectrumProviders", () => {
  it("expands boolean shorthands and drops disabled providers", () => {
    const providers = resolveSpectrumProviders({
      imessage: true,
      telegram: { botToken: " tok ", baseUrl: "" },
      whatsappBusiness: { enabled: false, accessToken: "x" },
      slack: false,
    });
    expect(providers).toEqual({ imessage: {}, telegram: { botToken: "tok" } });
    expect(listEnabledPlatforms(providers)).toEqual(["imessage", "telegram"]);
  });

  it("keeps iMessage direct clients", () => {
    const clients = [{ address: "host:443", token: "t", phone: "+15550001111" }];
    expect(resolveSpectrumProviders({ imessage: { clients } })).toEqual({
      imessage: { clients },
    });
  });
});

describe("resolveSpectrumAccount", () => {
  it("resolves a top-level default account with cloud credentials", () => {
    const cfg: CoreConfig = {
      channels: {
        spectrum: {
          projectId: "proj",
          projectSecret: "secret",
          providers: { imessage: true },
          allowFrom: ["imessage:+15551234567"],
        },
      },
    };
    expect(listSpectrumAccountIds(cfg)).toEqual(["default"]);
    expect(resolveDefaultSpectrumAccountId(cfg)).toBe("default");
    const account = resolveSpectrumAccount({ cfg, env: {} });
    expect(account).toMatchObject({
      accountId: "default",
      enabled: true,
      configured: true,
      projectId: "proj",
      projectSecret: "secret",
      credentialSource: "config",
      enabledPlatforms: ["imessage"],
    });
    expect(account.config.dmPolicy).toBe("pairing");
    expect(account.config.groupPolicy).toBe("allowlist");
  });

  it("falls back to SPECTRUM_PROJECT_* env only for the default account", () => {
    const cfg: CoreConfig = {
      channels: {
        spectrum: {
          providers: { telegram: true },
          accounts: { work: { providers: { imessage: true } } },
        },
      },
    };
    const env = { SPECTRUM_PROJECT_ID: "envproj", SPECTRUM_PROJECT_SECRET: "envsecret" };
    expect(resolveSpectrumAccount({ cfg, accountId: "default", env })).toMatchObject({
      projectId: "envproj",
      credentialSource: "env",
    });
    expect(resolveSpectrumAccount({ cfg, accountId: "work", env })).toMatchObject({
      projectId: undefined,
      credentialSource: "none",
    });
  });

  it("merges named accounts over channel defaults", () => {
    const cfg: CoreConfig = {
      channels: {
        spectrum: {
          dmPolicy: "allowlist",
          accounts: {
            personal: { providers: { telegram: { botToken: "abc" } }, dmPolicy: "open", allowFrom: ["*"] },
            off: { enabled: false, providers: { imessage: true } },
          },
        },
      },
    };
    expect(listSpectrumAccountIds(cfg).sort()).toEqual(["off", "personal"]);
    const personal = resolveSpectrumAccount({ cfg, accountId: "personal", env: {} });
    expect(personal.config.dmPolicy).toBe("open");
    expect(personal.providers.telegram).toEqual({ botToken: "abc" });
    expect(resolveSpectrumAccount({ cfg, accountId: "off", env: {} }).enabled).toBe(false);
  });

  it("is not configured without providers or with half of the project credentials", () => {
    const noProviders: CoreConfig = { channels: { spectrum: { projectId: "p", projectSecret: "s" } } };
    expect(resolveSpectrumAccount({ cfg: noProviders, env: {} }).configured).toBe(false);
    const partial: CoreConfig = {
      channels: { spectrum: { projectId: "p", providers: { imessage: true } } },
    };
    expect(resolveSpectrumAccount({ cfg: partial, env: {} }).configured).toBe(false);
  });
});
