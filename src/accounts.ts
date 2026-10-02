import {
  createAccountListHelpers,
  resolveChannelMediaMaxBytes,
} from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { CHANNEL_ID } from "./constants.js";
import type {
  CoreConfig,
  IMessageClientConfig,
  ResolvedSpectrumAccount,
  ResolvedSpectrumProviders,
  SpectrumAccountConfig,
  SpectrumCredentialSource,
} from "./types.js";

const {
  listAccountIds: listSpectrumAccountIds,
  resolveDefaultAccountId: resolveDefaultSpectrumAccountId,
  resolveAccountConfig: resolveMergedSpectrumAccountConfig,
} = createAccountListHelpers<SpectrumAccountConfig>(CHANNEL_ID, {
  normalizeAccountId,
  omitKeys: ["defaultAccount"],
  nestedObjectKeys: ["providers"],
  implicitDefaultAccount: {
    channelKeys: ["projectId", "providers"],
  },
});

export { DEFAULT_ACCOUNT_ID, listSpectrumAccountIds, resolveDefaultSpectrumAccountId };

type ProviderEntry<T> = boolean | (T & { enabled?: boolean }) | undefined;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function enabledProvider<T extends object>(entry: ProviderEntry<T>): T | undefined {
  if (entry === undefined || entry === false) {
    return undefined;
  }
  if (entry === true) {
    return {} as T;
  }
  if (entry.enabled === false) {
    return undefined;
  }
  const { enabled: _enabled, ...rest } = entry;
  return rest as T;
}

function compactRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

/** Normalize the OpenClaw provider config block into per-provider Spectrum config inputs. */
export function resolveSpectrumProviders(
  providers: SpectrumAccountConfig["providers"],
): ResolvedSpectrumProviders {
  const resolved: ResolvedSpectrumProviders = {};
  const imessage = enabledProvider<{ clients?: IMessageClientConfig[] }>(providers?.imessage);
  if (imessage) {
    resolved.imessage = imessage.clients?.length ? { clients: imessage.clients } : {};
  }
  const telegram = enabledProvider<{
    botToken?: string;
    webhookSecret?: string;
    baseUrl?: string;
  }>(providers?.telegram);
  if (telegram) {
    resolved.telegram = compactRecord({
      botToken: trimmed(telegram.botToken),
      webhookSecret: trimmed(telegram.webhookSecret),
      baseUrl: trimmed(telegram.baseUrl),
    });
  }
  const whatsappBusiness = enabledProvider<{
    accessToken?: string;
    appSecret?: string;
    phoneNumberId?: string;
  }>(providers?.whatsappBusiness);
  if (whatsappBusiness) {
    resolved.whatsappBusiness = compactRecord({
      accessToken: trimmed(whatsappBusiness.accessToken),
      appSecret: trimmed(whatsappBusiness.appSecret),
      phoneNumberId: trimmed(whatsappBusiness.phoneNumberId),
    });
  }
  const slack = enabledProvider<{ tokens?: Record<string, string>; endpoint?: string }>(
    providers?.slack,
  );
  if (slack) {
    resolved.slack = compactRecord({
      tokens: slack.tokens && Object.keys(slack.tokens).length > 0 ? slack.tokens : undefined,
      endpoint: trimmed(slack.endpoint),
    });
  }
  return resolved;
}

export function listEnabledPlatforms(providers: ResolvedSpectrumProviders): string[] {
  const platforms: string[] = [];
  if (providers.imessage) platforms.push("imessage");
  if (providers.telegram) platforms.push("telegram");
  if (providers.whatsappBusiness) platforms.push("whatsapp_business");
  if (providers.slack) platforms.push("slack");
  return platforms;
}

function resolveProjectCredentials(params: {
  accountId: string;
  merged: SpectrumAccountConfig;
  env: NodeJS.ProcessEnv;
}): { projectId?: string; projectSecret?: string; source: SpectrumCredentialSource } {
  const projectId = trimmed(params.merged.projectId);
  const projectSecret = trimmed(params.merged.projectSecret);
  if (projectId || projectSecret) {
    return { projectId, projectSecret, source: "config" };
  }
  if (params.accountId === DEFAULT_ACCOUNT_ID) {
    const envId = trimmed(params.env.SPECTRUM_PROJECT_ID);
    const envSecret = trimmed(params.env.SPECTRUM_PROJECT_SECRET);
    if (envId || envSecret) {
      return { projectId: envId, projectSecret: envSecret, source: "env" };
    }
  }
  return { source: "none" };
}

export function resolveSpectrumAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
  env?: NodeJS.ProcessEnv;
}): ResolvedSpectrumAccount {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultSpectrumAccountId(params.cfg),
  );
  const merged = resolveMergedSpectrumAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.spectrum?.enabled !== false;
  const enabled = baseEnabled && merged.enabled !== false;
  const credentials = resolveProjectCredentials({
    accountId,
    merged,
    env: params.env ?? process.env,
  });
  const providers = resolveSpectrumProviders(merged.providers);
  const enabledPlatforms = listEnabledPlatforms(providers);
  const hasPartialCredentials = Boolean(credentials.projectId) !== Boolean(credentials.projectSecret);
  return {
    accountId,
    enabled,
    configured: enabledPlatforms.length > 0 && !hasPartialCredentials,
    name: trimmed(merged.name),
    projectId: credentials.projectId,
    projectSecret: credentials.projectSecret,
    credentialSource: credentials.source,
    providers,
    enabledPlatforms,
    mediaMaxBytes: resolveChannelMediaMaxBytes({
      cfg: params.cfg,
      accountId,
      resolveChannelLimitMb: () => merged.mediaMaxMb,
    }),
    config: {
      ...merged,
      dmPolicy: merged.dmPolicy ?? "pairing",
      groupPolicy: merged.groupPolicy ?? "allowlist",
    },
  };
}

export function listEnabledSpectrumAccounts(cfg: CoreConfig): ResolvedSpectrumAccount[] {
  return listSpectrumAccountIds(cfg)
    .map((accountId) => resolveSpectrumAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
