import {
  ChannelGroupEntrySchema,
  DmPolicySchema,
  GroupPolicySchema,
  buildChannelConfigSchema,
  buildMultiAccountChannelSchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "zod";

const AllowEntrySchema = z.union([z.string(), z.number()]);

const IMessageClientSchema = z
  .object({
    address: z.string(),
    token: z.string(),
    phone: z.string(),
  })
  .strict();

const IMessageProviderSchema = z
  .object({
    enabled: z.boolean().optional(),
    clients: z.array(IMessageClientSchema).optional(),
  })
  .strict();

const TelegramProviderSchema = z
  .object({
    enabled: z.boolean().optional(),
    botToken: z.string().optional(),
    webhookSecret: z.string().optional(),
    baseUrl: z.string().optional(),
  })
  .strict();

const WhatsAppBusinessProviderSchema = z
  .object({
    enabled: z.boolean().optional(),
    accessToken: z.string().optional(),
    appSecret: z.string().optional(),
    phoneNumberId: z.string().optional(),
  })
  .strict();

const SlackProviderSchema = z
  .object({
    enabled: z.boolean().optional(),
    tokens: z.record(z.string(), z.string()).optional(),
    endpoint: z.string().optional(),
  })
  .strict();

export const SpectrumProvidersSchema = z
  .object({
    imessage: z.union([z.boolean(), IMessageProviderSchema]).optional(),
    telegram: z.union([z.boolean(), TelegramProviderSchema]).optional(),
    whatsappBusiness: z.union([z.boolean(), WhatsAppBusinessProviderSchema]).optional(),
    slack: z.union([z.boolean(), SlackProviderSchema]).optional(),
  })
  .strict();

export const SpectrumAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    projectId: z.string().optional(),
    projectSecret: z.string().optional(),
    providers: SpectrumProvidersSchema.optional(),
    dmPolicy: DmPolicySchema.optional(),
    allowFrom: z.array(AllowEntrySchema).optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groupAllowFrom: z.array(AllowEntrySchema).optional(),
    groups: z.record(z.string(), ChannelGroupEntrySchema.optional()).optional(),
    defaultTo: z.string().optional(),
    markdown: z.boolean().optional(),
    typingIndicator: z.boolean().optional(),
    mediaMaxMb: z.number().positive().optional(),
    textChunkLimit: z.number().int().positive().optional(),
  })
  .strict();

export const SpectrumConfigSchema = buildMultiAccountChannelSchema(SpectrumAccountSchemaBase, {
  optionalAccount: true,
  refine: (value, ctx) => {
    requireOpenAllowFrom({
      policy: value.dmPolicy,
      allowFrom: value.allowFrom,
      ctx,
      path: ["allowFrom"],
      message:
        'channels.spectrum.dmPolicy="open" requires channels.spectrum.allowFrom to include "*"',
    });
  },
});

export const spectrumChannelConfigSchema = buildChannelConfigSchema(SpectrumConfigSchema, {
  uiHints: {
    projectId: { label: "Spectrum project ID" },
    projectSecret: { label: "Spectrum project secret", sensitive: true },
    "providers.telegram.botToken": { label: "Telegram bot token", sensitive: true },
    "providers.whatsappBusiness.accessToken": {
      label: "WhatsApp Business access token",
      sensitive: true,
    },
    "providers.whatsappBusiness.appSecret": {
      label: "WhatsApp Business app secret",
      sensitive: true,
    },
  },
});
