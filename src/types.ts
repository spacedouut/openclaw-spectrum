import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { z } from "zod";
import type { SpectrumAccountSchemaBase } from "./config-schema.js";

export type SpectrumAccountConfig = z.input<typeof SpectrumAccountSchemaBase>;

export type SpectrumChannelConfig = SpectrumAccountConfig & {
  accounts?: Record<string, SpectrumAccountConfig | undefined>;
  defaultAccount?: string;
};

export type CoreConfig = OpenClawConfig & {
  channels?: OpenClawConfig["channels"] & {
    spectrum?: SpectrumChannelConfig;
  };
};

export type IMessageClientConfig = { address: string; token: string; phone: string };

export type ResolvedSpectrumProviders = {
  imessage?: { clients?: IMessageClientConfig[] };
  telegram?: { botToken?: string; webhookSecret?: string; baseUrl?: string };
  whatsappBusiness?: { accessToken?: string; appSecret?: string; phoneNumberId?: string };
  slack?: { tokens?: Record<string, string>; endpoint?: string };
};

export type SpectrumCredentialSource = "config" | "env" | "none";

export type ResolvedSpectrumAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  projectId?: string;
  projectSecret?: string;
  credentialSource: SpectrumCredentialSource;
  providers: ResolvedSpectrumProviders;
  enabledPlatforms: string[];
  mediaMaxBytes?: number;
  config: SpectrumAccountConfig;
};
