import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { patchScopedAccountConfig, type OpenClawConfig } from "openclaw/plugin-sdk/setup";
import { listEnabledPlatforms, resolveSpectrumProviders } from "./accounts.js";
import { CHANNEL_ID, SPECTRUM_PLATFORMS, type SpectrumPlatform } from "./constants.js";
import { resolveSpectrumPlatform } from "./targets.js";
import type { CoreConfig, SpectrumAccountConfig } from "./types.js";

type ProviderKey = keyof NonNullable<SpectrumAccountConfig["providers"]>;

const PROVIDER_CONFIG_KEYS: Record<SpectrumPlatform, ProviderKey> = {
  imessage: "imessage",
  telegram: "telegram",
  whatsapp_business: "whatsappBusiness",
  slack: "slack",
};

/** `null` removes the field so Spectrum falls back to its environment variables. */
type FieldPatch<Keys extends string> = Partial<Record<Keys, string | null>>;

export type SpectrumSetupPatch = {
  projectId?: string | null;
  projectSecret?: string | null;
  /** Exact set of enabled providers for the account. */
  platforms?: readonly SpectrumPlatform[];
  telegram?: FieldPatch<"botToken">;
  whatsappBusiness?: FieldPatch<"accessToken" | "appSecret" | "phoneNumberId">;
};

export function isSpectrumPlatform(value: string): value is SpectrumPlatform {
  return SPECTRUM_PLATFORMS.some((platform) => platform === value);
}

export function parseSpectrumPlatforms(
  entries: readonly string[],
): { platforms: SpectrumPlatform[] } | { error: string } {
  const platforms: SpectrumPlatform[] = [];
  for (const entry of entries) {
    const platform = resolveSpectrumPlatform(entry);
    if (!platform || !isSpectrumPlatform(platform)) {
      return {
        error: `Unknown Spectrum provider "${entry}". Use one of: ${SPECTRUM_PLATFORMS.join(", ")}.`,
      };
    }
    if (!platforms.includes(platform)) {
      platforms.push(platform);
    }
  }
  return { platforms };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawAccountSection(cfg: CoreConfig, accountId: string): SpectrumAccountConfig | undefined {
  const section = cfg.channels?.spectrum;
  return accountId === DEFAULT_ACCOUNT_ID ? section : section?.accounts?.[accountId];
}

function applyPlatforms(params: {
  providers: Record<string, unknown>;
  selected: readonly SpectrumPlatform[];
  inherited: readonly string[];
}): void {
  for (const platform of SPECTRUM_PLATFORMS) {
    const key = PROVIDER_CONFIG_KEYS[platform];
    const entry = params.providers[key];
    if (params.selected.includes(platform)) {
      if (isRecord(entry)) {
        const { enabled: _enabled, ...rest } = entry;
        params.providers[key] = Object.keys(rest).length > 0 ? rest : true;
      } else {
        params.providers[key] = true;
      }
    } else if (isRecord(entry)) {
      params.providers[key] = { ...entry, enabled: false };
    } else if (params.inherited.includes(platform)) {
      params.providers[key] = false;
    } else {
      delete params.providers[key];
    }
  }
}

function applyProviderFields(
  providers: Record<string, unknown>,
  key: ProviderKey,
  fields: Partial<Record<string, string | null>> | undefined,
): void {
  if (!fields) {
    return;
  }
  const entry = providers[key];
  const next: Record<string, unknown> = isRecord(entry) ? { ...entry } : {};
  let setValue = false;
  for (const [field, value] of Object.entries(fields)) {
    if (value === null) {
      delete next[field];
    } else if (value !== undefined) {
      next[field] = value;
      setValue = true;
    }
  }
  if (!setValue && entry === undefined) {
    return;
  }
  if (setValue) {
    delete next.enabled;
  }
  providers[key] = Object.keys(next).length > 0 ? next : (entry ?? true);
}

/** Write setup answers into the canonical `channels.spectrum` account config. */
export function applySpectrumSetupPatch(params: {
  cfg: OpenClawConfig;
  accountId: string;
  patch: SpectrumSetupPatch;
}): OpenClawConfig {
  const cfg = params.cfg as CoreConfig;
  const accountId = normalizeAccountId(params.accountId);
  const { patch } = params;
  const accountPatch: Record<string, unknown> = {};
  const clearFields: string[] = [];

  if (patch.platforms || patch.telegram || patch.whatsappBusiness) {
    const providers: Record<string, unknown> = {
      ...rawAccountSection(cfg, accountId)?.providers,
    };
    if (patch.platforms) {
      applyPlatforms({
        providers,
        selected: patch.platforms,
        inherited:
          accountId === DEFAULT_ACCOUNT_ID
            ? []
            : listEnabledPlatforms(resolveSpectrumProviders(cfg.channels?.spectrum?.providers)),
      });
    }
    applyProviderFields(providers, "telegram", patch.telegram);
    applyProviderFields(providers, "whatsappBusiness", patch.whatsappBusiness);
    accountPatch.providers = providers;
  }

  for (const field of ["projectId", "projectSecret"] as const) {
    const value = patch[field];
    if (value === null) {
      clearFields.push(field);
    } else if (value !== undefined) {
      accountPatch[field] = value;
    }
  }

  return patchScopedAccountConfig({
    cfg: params.cfg,
    channelKey: CHANNEL_ID,
    accountId,
    patch: accountPatch,
    clearFields,
  });
}
