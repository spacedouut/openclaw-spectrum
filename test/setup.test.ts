import type { ChannelSetupWizard, OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk/setup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSpectrumAccount } from "../src/accounts.js";
import { applySpectrumSetupPatch } from "../src/setup-config.js";
import {
  spectrumSetupContract,
  spectrumSetupDmPolicy,
  spectrumSetupWizard,
} from "../src/setup-surface.js";
import type { CoreConfig } from "../src/types.js";

const TOKEN = "123456:test-token";

function prompter(answers: { select?: string; multiselect?: string[][]; confirm?: boolean }) {
  const multiselect = [...(answers.multiselect ?? [])];
  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note: vi.fn(async () => {}),
    select: vi.fn(async () => answers.select),
    multiselect: vi.fn(async () => multiselect.shift() ?? []),
    text: vi.fn(),
    confirm: vi.fn(async () => answers.confirm ?? false),
    progress: vi.fn(),
  } as unknown as WizardPrompter;
}

async function prepare(cfg: OpenClawConfig, accountId: string, p: WizardPrompter) {
  const result = await spectrumSetupWizard.prepare?.({
    cfg,
    accountId,
    credentialValues: {},
    runtime: {} as Parameters<NonNullable<ChannelSetupWizard["prepare"]>>[0]["runtime"],
    prompter: p,
  });
  if (!result?.cfg || !result.credentialValues) {
    throw new Error("prepare returned nothing");
  }
  return { cfg: result.cfg, credentialValues: result.credentialValues };
}

function credential(inputKey: string) {
  const entry = spectrumSetupWizard.credentials.find((c) => c.inputKey === inputKey);
  if (!entry) throw new Error(`missing credential ${inputKey}`);
  return entry;
}

function textInput(inputKey: string) {
  const entry = spectrumSetupWizard.textInputs?.find((c) => c.inputKey === inputKey);
  if (!entry) throw new Error(`missing text input ${inputKey}`);
  return entry;
}

function spectrum(cfg: OpenClawConfig) {
  return (cfg as CoreConfig).channels?.spectrum;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("spectrum setup wizard", () => {
  it("configures a Spectrum Cloud account with iMessage and Telegram", async () => {
    const p = prompter({ select: "cloud", multiselect: [["imessage", "telegram"]] });
    const prepared = await prepare({}, "default", p);
    const values = prepared.credentialValues;
    expect(await textInput("projectId").shouldPrompt?.({ cfg: prepared.cfg, accountId: "default", credentialValues: values })).toBe(true);
    expect(await textInput("whatsappPhoneNumberId").shouldPrompt?.({ cfg: prepared.cfg, accountId: "default", credentialValues: values })).toBe(false);

    let cfg = await textInput("projectId").applySet!({ cfg: prepared.cfg, accountId: "default", value: "proj_1" });
    cfg = await credential("projectSecret").applySet!({
      cfg,
      accountId: "default",
      credentialValues: values,
      value: "secret_1",
      resolvedValue: "secret_1",
    });
    cfg = await credential("telegramBotToken").applySet!({
      cfg,
      accountId: "default",
      credentialValues: values,
      value: TOKEN,
      resolvedValue: TOKEN,
    });

    expect(spectrum(cfg)).toEqual({
      enabled: true,
      projectId: "proj_1",
      projectSecret: "secret_1",
      providers: { imessage: true, telegram: { botToken: TOKEN } },
    });
    const account = resolveSpectrumAccount({ cfg: cfg as CoreConfig, env: {} });
    expect(account.configured).toBe(true);
    expect(await spectrumSetupWizard.status.resolveConfigured({ cfg })).toBe(true);
  });

  it("offers project credentials from the environment and keeps them out of config", async () => {
    vi.stubEnv("SPECTRUM_PROJECT_ID", "proj_env");
    vi.stubEnv("SPECTRUM_PROJECT_SECRET", "secret_env");
    const p = prompter({ select: "cloud", multiselect: [["imessage"]], confirm: true });
    const prepared = await prepare({}, "default", p);
    expect(prepared.credentialValues.spectrumMode).toBe("cloud-env");
    const ctx = { cfg: prepared.cfg, accountId: "default", credentialValues: prepared.credentialValues };
    expect(await textInput("projectId").shouldPrompt?.(ctx)).toBe(false);
    expect(
      await credential("projectSecret").shouldPrompt?.({
        ...ctx,
        state: credential("projectSecret").inspect(ctx),
      }),
    ).toBe(false);
    expect(spectrum(prepared.cfg)).toEqual({ enabled: true, providers: { imessage: true } });
    expect(resolveSpectrumAccount({ cfg: prepared.cfg as CoreConfig }).credentialSource).toBe("env");
  });

  it("configures self-hosted WhatsApp Business and clears Spectrum Cloud credentials", async () => {
    vi.stubEnv("SPECTRUM_WHATSAPP_BUSINESS_ACCESS_TOKEN", "wa_env");
    const start: OpenClawConfig = {
      channels: {
        spectrum: { projectId: "proj_old", projectSecret: "secret_old", providers: { imessage: true } },
      },
    } as OpenClawConfig;
    const p = prompter({ select: "direct", multiselect: [["whatsapp_business"]] });
    const prepared = await prepare(start, "default", p);
    expect(p.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        options: [
          { value: "telegram", label: "Telegram" },
          { value: "whatsapp_business", label: "WhatsApp Business" },
        ],
      }),
    );
    const values = prepared.credentialValues;
    let cfg = await textInput("whatsappPhoneNumberId").applySet!({
      cfg: prepared.cfg,
      accountId: "default",
      value: "1555000",
    });
    const access = credential("whatsappAccessToken");
    const state = access.inspect({ cfg, accountId: "default" });
    expect(state.envValue).toBe("wa_env");
    expect(await access.shouldPrompt?.({ cfg, accountId: "default", credentialValues: values, state })).toBe(true);
    cfg = await access.applyUseEnv!({ cfg, accountId: "default" });

    expect(spectrum(cfg)).toEqual({
      enabled: true,
      providers: { whatsappBusiness: { phoneNumberId: "1555000" } },
    });
  });

  it("re-prompts until at least one provider is selected", async () => {
    const p = prompter({ select: "cloud", multiselect: [[], ["slack"]] });
    const prepared = await prepare({}, "default", p);
    expect(p.multiselect).toHaveBeenCalledTimes(2);
    expect(p.note).toHaveBeenCalledWith("Select at least one provider.", "Photon Spectrum");
    expect(prepared.credentialValues.spectrumPlatforms).toBe("slack");
  });

  it("writes named accounts under accounts and disables inherited providers", async () => {
    const start = {
      channels: { spectrum: { providers: { imessage: true } } },
    } as OpenClawConfig;
    const p = prompter({ select: "direct", multiselect: [["telegram"]] });
    const prepared = await prepare(start, "bot", p);
    const cfg = await credential("telegramBotToken").applySet!({
      cfg: prepared.cfg,
      accountId: "bot",
      credentialValues: prepared.credentialValues,
      value: TOKEN,
      resolvedValue: TOKEN,
    });
    expect(spectrum(cfg)?.providers).toEqual({ imessage: true });
    expect(spectrum(cfg)?.accounts?.bot).toEqual({
      enabled: true,
      providers: { imessage: false, telegram: { botToken: TOKEN } },
    });
    expect(
      resolveSpectrumAccount({ cfg: cfg as CoreConfig, accountId: "bot" }).enabledPlatforms,
    ).toEqual(["telegram"]);
  });

  it("rejects SecretRef values that the Spectrum runtime cannot resolve", () => {
    const telegram = credential("telegramBotToken");
    const base = { cfg: {}, accountId: "default", credentialValues: {} };
    expect(() =>
      telegram.applySet!({
        ...base,
        value: { source: "env", provider: "default", id: "X" },
        resolvedValue: TOKEN,
      }),
    ).toThrow(/plain strings/);
  });

  it("sets DM policy and allowlist on the selected account", async () => {
    const start = {
      channels: { spectrum: { providers: { imessage: true }, accounts: { bot: {} } } },
    } as OpenClawConfig;
    const cfg = spectrumSetupDmPolicy.setPolicy(start, "open", "bot");
    expect(spectrum(cfg)?.accounts?.bot).toMatchObject({ dmPolicy: "open", allowFrom: ["*"] });
    expect(spectrumSetupDmPolicy.getCurrent(cfg, "bot")).toBe("open");
    expect(spectrumSetupDmPolicy.resolveConfigKeys?.(cfg, "bot")).toEqual({
      policyKey: "channels.spectrum.accounts.bot.dmPolicy",
      allowFromKey: "channels.spectrum.accounts.bot.allowFrom",
    });
    expect(spectrumSetupWizard.allowFrom?.parseId("tg:42")).toBe("telegram:42");
    expect(spectrumSetupWizard.allowFrom?.parseId("42")).toBeNull();
  });

  it("disables the channel", () => {
    const cfg = spectrumSetupWizard.disable?.({
      channels: { spectrum: { enabled: true, providers: { imessage: true } } },
    } as OpenClawConfig);
    expect(spectrum(cfg!)?.enabled).toBe(false);
  });
});

describe("spectrum setup contract", () => {
  it("applies non-interactive CLI input", () => {
    const input = {
      projectId: "proj_1",
      projectSecret: "secret_1",
      providers: ["imessage", "tg"],
      telegramBotToken: TOKEN,
    };
    expect(spectrumSetupContract.parseInput(input)).toMatchObject({ ok: true });
    expect(spectrumSetupContract.validateInput?.({ cfg: {}, accountId: "default", input })).toBeNull();
    const cfg = spectrumSetupContract.applyAccountConfig({ cfg: {}, accountId: "default", input });
    expect(spectrum(cfg)).toEqual({
      enabled: true,
      projectId: "proj_1",
      projectSecret: "secret_1",
      providers: { imessage: true, telegram: { botToken: TOKEN } },
    });
  });

  it("explains missing providers, partial cloud credentials, and unknown providers", () => {
    const validate = (input: unknown) =>
      spectrumSetupContract.validateInput?.({ cfg: {}, accountId: "work", input });
    expect(validate({ projectId: "proj_1" })).toMatch(/at least one provider/);
    expect(validate({ providers: ["imessage"], projectId: "proj_1" })).toMatch(
      /both --project-id and --project-secret/,
    );
    expect(validate({ providers: ["discord"] })).toMatch(/Unknown Spectrum provider "discord"/);
    expect(validate({ providers: ["telegram"], botToken: TOKEN })).toMatch(
      /Unsupported setup option: botToken/,
    );
  });

  it("keeps existing provider settings when re-enabling a provider", () => {
    const cfg = applySpectrumSetupPatch({
      cfg: {
        channels: {
          spectrum: {
            providers: { telegram: { enabled: false, botToken: TOKEN }, slack: true },
          },
        },
      } as OpenClawConfig,
      accountId: "default",
      patch: { platforms: ["telegram"] },
    });
    expect(spectrum(cfg)?.providers).toEqual({ telegram: { botToken: TOKEN } });
  });
});
