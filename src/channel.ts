import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
  type ChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { PAIRING_APPROVED_MESSAGE } from "openclaw/plugin-sdk/channel-status";
import { chunkTextForOutbound } from "openclaw/plugin-sdk/text-chunking";
import { DEFAULT_ACCOUNT_ID } from "./accounts.js";
import { spectrumChannelConfigSchema } from "./config-schema.js";
import { CHANNEL_ID } from "./constants.js";
import { startSpectrumGatewayAccount } from "./gateway.js";
import { sendSpectrumMessage } from "./send.js";
import {
  spectrumCapabilities,
  spectrumConfigAdapter,
  spectrumMeta,
  spectrumSetupContract,
  spectrumSetupWizard,
} from "./setup-surface.js";
import { spectrumStatus } from "./status.js";
import {
  inferSpectrumTargetChatType,
  normalizeSpectrumSenderKey,
  normalizeSpectrumTarget,
  parseSpectrumTarget,
} from "./targets.js";
import type { CoreConfig, ResolvedSpectrumAccount } from "./types.js";

const DEFAULT_TEXT_CHUNK_LIMIT = 4_000;

function pairingTarget(id: string): string {
  const target = parseSpectrumTarget(id);
  if (!target) {
    throw new Error(`invalid Spectrum pairing id: ${id}`);
  }
  return `${target.platform}:user:${target.id}`;
}

export const spectrumPlugin: ChannelPlugin<ResolvedSpectrumAccount> = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta: spectrumMeta,
    capabilities: spectrumCapabilities,
    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
    configSchema: spectrumChannelConfigSchema,
    config: spectrumConfigAdapter,
    setupContract: spectrumSetupContract,
    setupWizard: spectrumSetupWizard,
    messaging: {
      targetPrefixes: [CHANNEL_ID],
      normalizeTarget: normalizeSpectrumTarget,
      inferTargetChatType: ({ to }) => {
        const target = parseSpectrumTarget(to);
        return target ? inferSpectrumTargetChatType(target) : undefined;
      },
      targetResolver: {
        looksLikeId: (raw) => parseSpectrumTarget(raw) !== null,
        hint: "<imessage|telegram|whatsapp|slack>:<spaceId> or <platform>:user:<userId>",
      },
      resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target }) => {
        const parsed = parseSpectrumTarget(target);
        if (!parsed) {
          return null;
        }
        const normalized = normalizeSpectrumTarget(target) ?? target;
        const chatType = inferSpectrumTargetChatType(parsed);
        return buildChannelOutboundSessionRoute({
          cfg,
          agentId,
          channel: CHANNEL_ID,
          accountId,
          recipientSessionExact: true,
          peer: { kind: chatType, id: normalized },
          chatType,
          from: `${CHANNEL_ID}:${accountId ?? DEFAULT_ACCOUNT_ID}`,
          to: normalized,
        });
      },
    },
    status: spectrumStatus,
    gateway: {
      startAccount: async (ctx) => await startSpectrumGatewayAccount(ctx),
    },
  },
  security: {
    dm: {
      channelKey: CHANNEL_ID,
      resolvePolicy: (account) => account.config.dmPolicy,
      resolveAllowFrom: (account) => account.config.allowFrom,
      defaultPolicy: "pairing",
      normalizeEntry: (raw) => normalizeSpectrumSenderKey(raw) ?? raw.trim(),
    },
  },
  pairing: {
    text: {
      idLabel: "spectrumSender",
      message: PAIRING_APPROVED_MESSAGE,
      normalizeAllowEntry: (entry) => normalizeSpectrumSenderKey(entry) ?? entry.trim(),
      notify: async ({ cfg, id, message, accountId }) => {
        await sendSpectrumMessage({
          cfg: cfg as CoreConfig,
          accountId,
          to: pairingTarget(id),
          text: message,
        });
      },
    },
  },
  outbound: {
    base: {
      deliveryMode: "direct",
      chunker: chunkTextForOutbound,
      chunkerMode: "markdown",
      textChunkLimit: DEFAULT_TEXT_CHUNK_LIMIT,
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async (ctx) =>
        await sendSpectrumMessage({
          cfg: ctx.cfg as CoreConfig,
          accountId: ctx.accountId,
          to: ctx.to,
          text: ctx.text,
        }),
      sendMedia: async (ctx) =>
        await sendSpectrumMessage({
          cfg: ctx.cfg as CoreConfig,
          accountId: ctx.accountId,
          to: ctx.to,
          text: ctx.text,
          mediaUrls: ctx.mediaUrl ? [ctx.mediaUrl] : [],
          mediaLocalRoots: ctx.mediaLocalRoots,
          mediaReadFile: ctx.mediaReadFile,
        }),
    },
  },
});
