import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { defineChannelSetupContract } from "openclaw/plugin-sdk/channel-setup";
import {
  addWildcardAllowFrom,
  applyAccountNameToChannelSection,
  createAllowFromSection,
  createPromptParsedAllowFromForAccount,
  createStandardChannelSetupStatus,
  DEFAULT_ACCOUNT_ID,
  parseSetupEntriesWithParser,
  patchScopedAccountConfig,
  setSetupChannelEnabled,
  type ChannelSetupDmPolicy,
  type ChannelSetupWizard,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/setup";
import {
  listSpectrumAccountIds,
  resolveDefaultSpectrumAccountId,
  resolveSpectrumAccount,
} from "./accounts.js";
import { spectrumChannelConfigSchema } from "./config-schema.js";
import { CHANNEL_ID, CHANNEL_LABEL, SPECTRUM_PLATFORMS, type SpectrumPlatform } from "./constants.js";
import {
  applySpectrumSetupPatch,
  isSpectrumPlatform,
  parseSpectrumPlatforms,
  type SpectrumSetupPatch,
} from "./setup-config.js";
import { normalizeSpectrumSenderKey } from "./targets.js";
import type { CoreConfig, ResolvedSpectrumAccount } from "./types.js";

export const spectrumMeta = {
  id: CHANNEL_ID,
  label: CHANNEL_LABEL,
  selectionLabel: "Photon Spectrum (iMessage, Telegram, WhatsApp)",
  detailLabel: "Spectrum",
  docsPath: "/channels/spectrum",
  docsLabel: "spectrum",
  blurb: "iMessage, Telegram, and WhatsApp Business through Photon Spectrum.",
  aliases: ["photon", "photon-spectrum"],
  markdownCapable: true,
};

export const spectrumCapabilities: ChannelPlugin<ResolvedSpectrumAccount>["capabilities"] = {
  chatTypes: ["direct", "group"],
  media: true,
};

export const spectrumConfigAdapter: ChannelPlugin<ResolvedSpectrumAccount>["config"] = {
  listAccountIds: (cfg) => listSpectrumAccountIds(cfg as CoreConfig),
  resolveAccount: (cfg, accountId) => resolveSpectrumAccount({ cfg: cfg as CoreConfig, accountId }),
  defaultAccountId: (cfg) => resolveDefaultSpectrumAccountId(cfg as CoreConfig),
  isConfigured: (account) => account.configured,
  isEnabled: (account) => account.enabled,
  resolveAllowFrom: ({ cfg, accountId }) =>
    resolveSpectrumAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom,
  resolveDefaultTo: ({ cfg, accountId }) =>
    resolveSpectrumAccount({ cfg: cfg as CoreConfig, accountId }).config.defaultTo,
};

const PLATFORM_LABELS: Record<SpectrumPlatform, string> = {
  imessage: "iMessage",
  telegram: "Telegram",
  whatsapp_business: "WhatsApp Business",
  slack: "Slack",
};

/** Providers that can run without Spectrum Cloud using only wizard-collected credentials. */
const DIRECT_PLATFORMS: readonly SpectrumPlatform[] = ["telegram", "whatsapp_business"];

const TELEGRAM_TOKEN_ENV = "SPECTRUM_TELEGRAM_BOT_TOKEN";
const WHATSAPP_ACCESS_TOKEN_ENV = "SPECTRUM_WHATSAPP_BUSINESS_ACCESS_TOKEN";
const WHATSAPP_PHONE_NUMBER_ID_ENV = "SPECTRUM_WHATSAPP_BUSINESS_PHONE_NUMBER_ID";
const DOCS_URL = "https://photon.codes/docs/spectrum-ts/introduction";
const README_URL = "https://github.com/spacedouut/openclaw-spectrum#readme";

type SpectrumSetupMode = "cloud" | "cloud-env" | "direct";
type ChannelSetupWizardCredentialValues = Partial<Record<string, string>>;

const MODE_KEY = "spectrumMode";
const PLATFORMS_KEY = "spectrumPlatforms";

function wizardMode(values: ChannelSetupWizardCredentialValues): SpectrumSetupMode | undefined {
  const mode = values[MODE_KEY];
  return mode === "cloud" || mode === "cloud-env" || mode === "direct" ? mode : undefined;
}

function wizardPlatforms(values: ChannelSetupWizardCredentialValues): SpectrumPlatform[] {
  return (values[PLATFORMS_KEY] ?? "").split(",").filter(isSpectrumPlatform);
}

function trimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolveAccount(cfg: OpenClawConfig, accountId?: string): ResolvedSpectrumAccount {
  return resolveSpectrumAccount({ cfg: cfg as CoreConfig, accountId });
}

function configuredProjectValue(
  account: ResolvedSpectrumAccount,
  field: "projectId" | "projectSecret",
): string | undefined {
  return account.credentialSource === "config" ? account[field] : undefined;
}

function requirePlainSecret(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `${label}: Photon Spectrum config stores credentials as plain strings. Use an environment variable instead of a SecretRef.`,
    );
  }
  return value.trim();
}

function patchAccount(
  cfg: OpenClawConfig,
  accountId: string,
  patch: SpectrumSetupPatch,
): OpenClawConfig {
  return applySpectrumSetupPatch({ cfg, accountId, patch });
}

type SpectrumSetupInput = {
  name?: string;
  projectId?: string;
  projectSecret?: string;
  providers?: string[];
  telegramBotToken?: string;
  whatsappAccessToken?: string;
  whatsappAppSecret?: string;
  whatsappPhoneNumberId?: string;
};

function buildPatchFromInput(input: SpectrumSetupInput): { patch: SpectrumSetupPatch } | { error: string } {
  const patch: SpectrumSetupPatch = {};
  if (input.providers) {
    const parsed = parseSpectrumPlatforms(input.providers);
    if ("error" in parsed) {
      return parsed;
    }
    patch.platforms = parsed.platforms;
  }
  if (input.projectId?.trim()) {
    patch.projectId = input.projectId.trim();
  }
  if (input.projectSecret?.trim()) {
    patch.projectSecret = input.projectSecret.trim();
  }
  if (input.telegramBotToken?.trim()) {
    patch.telegram = { botToken: input.telegramBotToken.trim() };
  }
  const whatsappBusiness = {
    accessToken: input.whatsappAccessToken?.trim() || undefined,
    appSecret: input.whatsappAppSecret?.trim() || undefined,
    phoneNumberId: input.whatsappPhoneNumberId?.trim() || undefined,
  };
  if (Object.values(whatsappBusiness).some(Boolean)) {
    patch.whatsappBusiness = whatsappBusiness;
  }
  return { patch };
}

export const spectrumSetupContract = defineChannelSetupContract({
  fields: {
    projectId: {
      kind: "string",
      cli: { flags: "--project-id <id>", description: "Spectrum Cloud project ID" },
      envVars: ["SPECTRUM_PROJECT_ID"],
    },
    projectSecret: {
      kind: "string",
      sensitive: true,
      cli: { flags: "--project-secret <secret>", description: "Spectrum Cloud project secret" },
      envVars: ["SPECTRUM_PROJECT_SECRET"],
    },
    providers: {
      kind: "string-list",
      cli: {
        flags: "--providers <list>",
        description: `Comma-separated Spectrum providers (${SPECTRUM_PLATFORMS.join(", ")})`,
      },
    },
    telegramBotToken: {
      kind: "string",
      sensitive: true,
      cli: { flags: "--telegram-bot-token <token>", description: "Telegram bot token from @BotFather" },
      envVars: [TELEGRAM_TOKEN_ENV],
    },
    whatsappAccessToken: {
      kind: "string",
      sensitive: true,
      cli: {
        flags: "--whatsapp-access-token <token>",
        description: "WhatsApp Business Cloud API access token (self-hosted)",
      },
      envVars: [WHATSAPP_ACCESS_TOKEN_ENV],
    },
    whatsappAppSecret: {
      kind: "string",
      sensitive: true,
      cli: {
        flags: "--whatsapp-app-secret <secret>",
        description: "WhatsApp Business app secret for webhook signatures (self-hosted)",
      },
    },
    whatsappPhoneNumberId: {
      kind: "string",
      cli: {
        flags: "--whatsapp-phone-number-id <id>",
        description: "WhatsApp Business phone number ID (self-hosted)",
      },
      envVars: [WHATSAPP_PHONE_NUMBER_ID_ENV],
    },
  },
  adapter: {
    configPromotion: "preserve-root",
    singleAccountKeysToMove: [],
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({ cfg, channelKey: CHANNEL_ID, accountId, name }),
    validateInput: ({ cfg, accountId, input }) => {
      const result = buildPatchFromInput(input);
      if ("error" in result) {
        return result.error;
      }
      const account = resolveAccount(patchAccount(cfg, accountId, result.patch), accountId);
      if (account.enabledPlatforms.length === 0) {
        return "Photon Spectrum needs at least one provider, for example --providers imessage,telegram.";
      }
      if (Boolean(account.projectId) !== Boolean(account.projectSecret)) {
        return "Spectrum Cloud needs both --project-id and --project-secret.";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const result = buildPatchFromInput(input);
      if ("error" in result) {
        throw new Error(result.error);
      }
      return patchAccount(cfg, accountId, result.patch);
    },
  },
});

function parseAllowFromEntries(raw: string): { entries: string[]; error?: string } {
  return parseSetupEntriesWithParser(raw, (entry) => {
    const key = normalizeSpectrumSenderKey(entry);
    return key
      ? { value: key }
      : {
          error: `Invalid Spectrum sender "${entry}". Use <platform>:<userId>, for example telegram:123456789.`,
        };
  });
}

function patchAccountSection(
  cfg: OpenClawConfig,
  accountId: string,
  patch: Record<string, unknown>,
): OpenClawConfig {
  return patchScopedAccountConfig({ cfg, channelKey: CHANNEL_ID, accountId, patch });
}

const ALLOW_FROM_MESSAGE = "Spectrum senders allowed to DM the agent";
const ALLOW_FROM_PLACEHOLDER = "telegram:123456789, imessage:+15551234567";
const ALLOW_FROM_HELP = [
  "Entries are <platform>:<userId>, for example telegram:123456789 or imessage:+15551234567.",
  "Unknown senders show their id in the pairing prompt and in `openclaw logs --follow`.",
];

export const spectrumSetupDmPolicy: ChannelSetupDmPolicy = {
  label: CHANNEL_LABEL,
  channel: CHANNEL_ID,
  policyKey: `channels.${CHANNEL_ID}.dmPolicy`,
  allowFromKey: `channels.${CHANNEL_ID}.allowFrom`,
  resolveConfigKeys: (cfg, accountId) => {
    const resolved = resolveAccount(cfg, accountId).accountId;
    const prefix =
      resolved === DEFAULT_ACCOUNT_ID
        ? `channels.${CHANNEL_ID}`
        : `channels.${CHANNEL_ID}.accounts.${resolved}`;
    return { policyKey: `${prefix}.dmPolicy`, allowFromKey: `${prefix}.allowFrom` };
  },
  getCurrent: (cfg, accountId) => resolveAccount(cfg, accountId).config.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy, accountId) => {
    const account = resolveAccount(cfg, accountId);
    return patchAccountSection(cfg, account.accountId, {
      dmPolicy: policy,
      ...(policy === "open" ? { allowFrom: addWildcardAllowFrom(account.config.allowFrom) } : {}),
    });
  },
  promptAllowFrom: createPromptParsedAllowFromForAccount({
    defaultAccountId: (cfg) => resolveDefaultSpectrumAccountId(cfg as CoreConfig),
    noteTitle: "Photon Spectrum allowlist",
    noteLines: ALLOW_FROM_HELP,
    message: ALLOW_FROM_MESSAGE,
    placeholder: ALLOW_FROM_PLACEHOLDER,
    parseEntries: parseAllowFromEntries,
    getExistingAllowFrom: ({ cfg, accountId }) => resolveAccount(cfg, accountId).config.allowFrom ?? [],
    applyAllowFrom: ({ cfg, accountId, allowFrom }) =>
      patchAccountSection(cfg, accountId, { allowFrom }),
  }),
};

async function promptPlatforms(params: {
  prompter: Parameters<NonNullable<ChannelSetupWizard["prepare"]>>[0]["prompter"];
  available: readonly SpectrumPlatform[];
  initial: SpectrumPlatform[];
}): Promise<SpectrumPlatform[]> {
  for (;;) {
    const selected = await params.prompter.multiselect<SpectrumPlatform>({
      message: "Which Spectrum providers should this account use?",
      options: params.available.map((platform) => ({
        value: platform,
        label: PLATFORM_LABELS[platform],
      })),
      initialValues: params.initial,
    });
    if (selected.length > 0) {
      return selected;
    }
    await params.prompter.note("Select at least one provider.", CHANNEL_LABEL);
  }
}

const prepareSpectrumSetup: NonNullable<ChannelSetupWizard["prepare"]> = async ({
  cfg,
  accountId,
  credentialValues,
  prompter,
}) => {
  const account = resolveAccount(cfg, accountId);
  const hasPlatforms = account.enabledPlatforms.length > 0;
  const mode = await prompter.select<"cloud" | "direct">({
    message: "How should this account connect to Spectrum?",
    options: [
      {
        value: "cloud",
        label: "Spectrum Cloud",
        hint: "Photon project ID and secret; iMessage, Telegram, WhatsApp Business, Slack",
      },
      {
        value: "direct",
        label: "Self-hosted",
        hint: "Your own Telegram bot or WhatsApp Business app, no Photon project",
      },
    ],
    initialValue: hasPlatforms && !account.projectId ? "direct" : "cloud",
  });

  const available = mode === "cloud" ? SPECTRUM_PLATFORMS : DIRECT_PLATFORMS;
  const current = account.enabledPlatforms.filter(isSpectrumPlatform).filter((platform) =>
    available.includes(platform),
  );
  const platforms = await promptPlatforms({
    prompter,
    available,
    initial: current.length > 0 ? current : [mode === "cloud" ? "imessage" : "telegram"],
  });

  let resolvedMode: SpectrumSetupMode = mode;
  if (
    mode === "cloud" &&
    account.credentialSource !== "config" &&
    accountId === DEFAULT_ACCOUNT_ID &&
    trimmedEnv("SPECTRUM_PROJECT_ID") &&
    trimmedEnv("SPECTRUM_PROJECT_SECRET")
  ) {
    const useEnv = await prompter.confirm({
      message: "SPECTRUM_PROJECT_ID and SPECTRUM_PROJECT_SECRET detected. Use them?",
      initialValue: true,
    });
    if (useEnv) {
      resolvedMode = "cloud-env";
    }
  }

  const next = patchAccount(cfg, accountId, {
    platforms,
    ...(resolvedMode === "cloud" ? {} : { projectId: null, projectSecret: null }),
  });
  if (mode === "direct" && resolveAccount(next, accountId).credentialSource === "config") {
    await prompter.note(
      `Account "${accountId}" still inherits projectId/projectSecret from channels.${CHANNEL_ID}, so it will keep using Spectrum Cloud.`,
      CHANNEL_LABEL,
    );
  }
  return {
    cfg: next,
    credentialValues: {
      ...credentialValues,
      [MODE_KEY]: resolvedMode,
      [PLATFORMS_KEY]: platforms.join(","),
    },
  };
};

const isCloud = (values: ChannelSetupWizardCredentialValues) => wizardMode(values) === "cloud";
const isDirectWith = (values: ChannelSetupWizardCredentialValues, platform: SpectrumPlatform) =>
  wizardMode(values) === "direct" && wizardPlatforms(values).includes(platform);

export const spectrumSetupWizard: ChannelSetupWizard = {
  channel: CHANNEL_ID,
  status: createStandardChannelSetupStatus({
    channelLabel: CHANNEL_LABEL,
    configuredLabel: "configured",
    unconfiguredLabel: "needs a provider",
    configuredHint: "configured",
    unconfiguredHint: "iMessage, Telegram, WhatsApp via Photon",
    configuredScore: 1,
    unconfiguredScore: 4,
    resolveConfigured: ({ cfg, accountId }) =>
      (accountId ? [accountId] : listSpectrumAccountIds(cfg as CoreConfig)).some(
        (id) => resolveAccount(cfg, id).configured,
      ),
    resolveExtraStatusLines: ({ cfg, accountId }) => {
      const platforms = resolveAccount(cfg, accountId)
        .enabledPlatforms.filter(isSpectrumPlatform)
        .map((platform) => PLATFORM_LABELS[platform]);
      return platforms.length > 0 ? [`Spectrum providers: ${platforms.join(", ")}`] : [];
    },
  }),
  introNote: {
    title: CHANNEL_LABEL,
    lines: [
      "Spectrum Cloud connects iMessage, Telegram, WhatsApp Business, and Slack with one Photon project.",
      "Self-hosted mode talks to Telegram or WhatsApp Business directly with your own credentials.",
      `Spectrum docs: ${DOCS_URL}`,
    ],
  },
  prepare: prepareSpectrumSetup,
  stepOrder: "text-first",
  textInputs: [
    {
      inputKey: "projectId",
      message: "Spectrum project ID",
      placeholder: "proj_...",
      helpTitle: "Spectrum Cloud project",
      helpLines: [
        "Find the project ID and secret in the Photon dashboard for your Spectrum project.",
        `Docs: ${DOCS_URL}`,
      ],
      shouldPrompt: ({ credentialValues }) => isCloud(credentialValues),
      currentValue: ({ cfg, accountId }) =>
        configuredProjectValue(resolveAccount(cfg, accountId), "projectId"),
      validate: ({ value }) => (value.trim() ? undefined : "Required"),
      normalizeValue: ({ value }) => value.trim(),
      applySet: ({ cfg, accountId, value }) => patchAccount(cfg, accountId, { projectId: value }),
    },
    {
      inputKey: "whatsappPhoneNumberId",
      message: "WhatsApp Business phone number ID",
      helpTitle: "WhatsApp Business",
      helpLines: [
        "Use the phone number ID, access token, and app secret from your Meta app's WhatsApp > API setup page.",
      ],
      shouldPrompt: ({ credentialValues }) => isDirectWith(credentialValues, "whatsapp_business"),
      currentValue: ({ cfg, accountId }) =>
        resolveAccount(cfg, accountId).providers.whatsappBusiness?.phoneNumberId ??
        trimmedEnv(WHATSAPP_PHONE_NUMBER_ID_ENV),
      validate: ({ value }) => (value.trim() ? undefined : "Required"),
      normalizeValue: ({ value }) => value.trim(),
      applySet: ({ cfg, accountId, value }) =>
        patchAccount(cfg, accountId, { whatsappBusiness: { phoneNumberId: value } }),
    },
    {
      inputKey: "whatsappAppSecret",
      message: "WhatsApp Business app secret (optional, verifies webhook signatures)",
      sensitive: true,
      required: false,
      shouldPrompt: ({ credentialValues }) => isDirectWith(credentialValues, "whatsapp_business"),
      currentValue: ({ cfg, accountId }) =>
        resolveAccount(cfg, accountId).providers.whatsappBusiness?.appSecret,
      normalizeValue: ({ value }) => value.trim(),
      applySet: ({ cfg, accountId, value }) =>
        patchAccount(cfg, accountId, { whatsappBusiness: { appSecret: value } }),
    },
  ],
  credentials: [
    {
      inputKey: "projectSecret",
      providerHint: CHANNEL_ID,
      credentialLabel: "Spectrum project secret",
      envPrompt: "SPECTRUM_PROJECT_SECRET detected. Use it?",
      keepPrompt: "Spectrum project secret already configured. Keep it?",
      inputPrompt: "Spectrum project secret",
      allowEnv: () => false,
      shouldPrompt: ({ credentialValues }) => isCloud(credentialValues),
      inspect: ({ cfg, accountId }) => {
        const account = resolveAccount(cfg, accountId);
        const value = configuredProjectValue(account, "projectSecret");
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: Boolean(value),
          ...(value ? { resolvedValue: value } : {}),
        };
      },
      applySet: ({ cfg, accountId, value }) =>
        patchAccount(cfg, accountId, {
          projectSecret: requirePlainSecret(value, "Spectrum project secret"),
        }),
    },
    {
      inputKey: "telegramBotToken",
      providerHint: CHANNEL_ID,
      credentialLabel: "Telegram bot token",
      preferredEnvVar: TELEGRAM_TOKEN_ENV,
      helpTitle: "Telegram bot token",
      helpLines: [
        "Open @BotFather in Telegram (https://t.me/BotFather), run /newbot, and copy the token.",
        `Tip: set ${TELEGRAM_TOKEN_ENV} in the Gateway environment to keep it out of config.`,
      ],
      envPrompt: `${TELEGRAM_TOKEN_ENV} detected. Use it?`,
      keepPrompt: "Telegram bot token already configured. Keep it?",
      inputPrompt: "Telegram bot token",
      allowEnv: () => true,
      shouldPrompt: ({ credentialValues }) => wizardPlatforms(credentialValues).includes("telegram"),
      inspect: ({ cfg, accountId }) => {
        const account = resolveAccount(cfg, accountId);
        const value = account.providers.telegram?.botToken;
        const envValue = trimmedEnv(TELEGRAM_TOKEN_ENV);
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: Boolean(value),
          ...(value ? { resolvedValue: value } : {}),
          ...(envValue ? { envValue } : {}),
        };
      },
      applyUseEnv: ({ cfg, accountId }) =>
        patchAccount(cfg, accountId, { telegram: { botToken: null } }),
      applySet: ({ cfg, accountId, value }) =>
        patchAccount(cfg, accountId, {
          telegram: { botToken: requirePlainSecret(value, "Telegram bot token") },
        }),
    },
    {
      inputKey: "whatsappAccessToken",
      providerHint: CHANNEL_ID,
      credentialLabel: "WhatsApp Business access token",
      preferredEnvVar: WHATSAPP_ACCESS_TOKEN_ENV,
      envPrompt: `${WHATSAPP_ACCESS_TOKEN_ENV} detected. Use it?`,
      keepPrompt: "WhatsApp Business access token already configured. Keep it?",
      inputPrompt: "WhatsApp Business access token",
      allowEnv: () => true,
      shouldPrompt: ({ credentialValues }) => isDirectWith(credentialValues, "whatsapp_business"),
      inspect: ({ cfg, accountId }) => {
        const account = resolveAccount(cfg, accountId);
        const value = account.providers.whatsappBusiness?.accessToken;
        const envValue = trimmedEnv(WHATSAPP_ACCESS_TOKEN_ENV);
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: Boolean(value),
          ...(value ? { resolvedValue: value } : {}),
          ...(envValue ? { envValue } : {}),
        };
      },
      applyUseEnv: ({ cfg, accountId }) =>
        patchAccount(cfg, accountId, { whatsappBusiness: { accessToken: null } }),
      applySet: ({ cfg, accountId, value }) =>
        patchAccount(cfg, accountId, {
          whatsappBusiness: {
            accessToken: requirePlainSecret(value, "WhatsApp Business access token"),
          },
        }),
    },
  ],
  dmPolicy: spectrumSetupDmPolicy,
  allowFrom: createAllowFromSection({
    helpTitle: "Photon Spectrum allowlist",
    helpLines: ALLOW_FROM_HELP,
    message: ALLOW_FROM_MESSAGE,
    placeholder: ALLOW_FROM_PLACEHOLDER,
    invalidWithoutCredentialNote:
      "Use <platform>:<userId> entries, for example telegram:123456789 or imessage:+15551234567.",
    parseId: (raw) => normalizeSpectrumSenderKey(raw) ?? null,
    apply: ({ cfg, accountId, allowFrom }) => patchAccountSection(cfg, accountId, { allowFrom }),
  }),
  completionNote: {
    title: CHANNEL_LABEL,
    lines: [
      "Restart the Gateway to start the Spectrum account: openclaw gateway restart",
      "New DM senders get a pairing code; approve with: openclaw pairing approve spectrum <code>",
      `Group access, per-space settings, and iMessage/Slack self-hosted clients: ${README_URL}`,
    ],
  },
  disable: (cfg) => setSetupChannelEnabled(cfg, CHANNEL_ID, false),
};

/** Setup-only plugin surface: config, setup contract, and wizard without the Spectrum runtime. */
export const spectrumSetupPlugin: ChannelPlugin<ResolvedSpectrumAccount> = {
  id: CHANNEL_ID,
  meta: spectrumMeta,
  capabilities: spectrumCapabilities,
  reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
  configSchema: spectrumChannelConfigSchema,
  config: spectrumConfigAdapter,
  setupContract: spectrumSetupContract,
  setupWizard: spectrumSetupWizard,
};
