import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import { resolveChannelInboundRouteEnvelope } from "openclaw/plugin-sdk/channel-inbound";
import { createChannelPairingController } from "openclaw/plugin-sdk/channel-pairing";
import type { Message, Space } from "spectrum-ts";
import { CHANNEL_ID, CHANNEL_LABEL } from "./constants.js";
import { normalizeSpectrumContent, type SpectrumInboundAttachment } from "./normalize.js";
import { rememberSpectrumSpace, type RunningSpectrumAccount } from "./registry.js";
import { deliverToSpectrumSpace } from "./send.js";
import {
  formatSpectrumSenderKey,
  normalizeSpectrumSenderKey,
  resolveSpaceChatType,
} from "./targets.js";
import type { CoreConfig, ResolvedSpectrumAccount } from "./types.js";

export type SpectrumInboundLogger = {
  info?: (message: string) => void;
  error?: (message: string) => void;
};

export type SpectrumInboundParams = {
  core: PluginRuntime;
  cfg: CoreConfig;
  account: ResolvedSpectrumAccount;
  entry: RunningSpectrumAccount;
  space: Space;
  message: Message;
  log?: SpectrumInboundLogger;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type SpectrumInboundOutcome =
  | "dispatched"
  | "ignored"
  | "pairing"
  | "blocked"
  | "skipped";

export const spectrumIngressIdentity = {
  key: "spectrum-sender",
  normalizeEntry: (value: string) => normalizeSpectrumSenderKey(value) ?? null,
  normalizeSubject: (value: string) => value,
  // Spectrum relays platform-authenticated sender ids (phone/handle, Telegram user id, ...).
  authentication: "asserted" as const,
  sensitivity: "pii" as const,
  isWildcardEntry: (entry: string) => entry.trim() === "*",
};

function resolveGroupEntry(account: ResolvedSpectrumAccount, spaceKey: string) {
  const groups = account.config.groups;
  if (!groups) {
    return { configured: false, entry: undefined, wildcard: undefined };
  }
  return {
    configured: Object.keys(groups).length > 0,
    entry: groups[spaceKey],
    wildcard: groups["*"],
  };
}

async function saveInboundAttachments(params: {
  core: PluginRuntime;
  attachments: readonly SpectrumInboundAttachment[];
  maxBytes?: number;
  messageId: string;
  log?: SpectrumInboundLogger;
}) {
  const media = [];
  for (const item of params.attachments) {
    if (params.maxBytes !== undefined && item.size !== undefined && item.size > params.maxBytes) {
      params.log?.info?.(
        `spectrum: skipping inbound attachment ${item.name ?? "(unnamed)"} (${item.size} bytes > limit)`,
      );
      continue;
    }
    try {
      const buffer = await item.read();
      const saved = await params.core.channel.media.saveMediaBuffer(
        buffer,
        item.mimeType,
        "inbound",
        params.maxBytes,
        item.name,
      );
      media.push({
        path: saved.path,
        contentType: saved.contentType ?? item.mimeType,
        fileName: item.name,
        sizeBytes: buffer.byteLength,
        messageId: params.messageId,
      });
    } catch (error) {
      params.log?.error?.(`spectrum: failed to save inbound attachment: ${String(error)}`);
    }
  }
  return media;
}

/** Route one inbound Spectrum message through OpenClaw access control and agent dispatch. */
export async function handleSpectrumInbound(
  params: SpectrumInboundParams,
): Promise<SpectrumInboundOutcome> {
  const { core, cfg, account, entry, space, message, log } = params;
  const config = cfg as OpenClawConfig;
  if (message.direction === "outbound" || message.sender?.kind === "agent") {
    return "ignored";
  }
  const sender = message.sender;
  if (!sender) {
    return "ignored";
  }
  const normalized = normalizeSpectrumContent(message.content);
  if (!normalized) {
    return "ignored";
  }

  const platform = message.platform;
  const spaceKey = rememberSpectrumSpace(entry, platform, space);
  const senderKey = formatSpectrumSenderKey(platform, sender.id);
  const chatType = resolveSpaceChatType({ platform, space, senderId: sender.id });
  const isGroup = chatType === "group";
  const timestamp = message.timestamp.getTime();
  params.statusSink?.({ lastInboundAt: timestamp });

  const group = isGroup ? resolveGroupEntry(account, spaceKey) : undefined;
  if (group) {
    const groupConfig = group.entry ?? group.wildcard;
    if (
      group.entry?.enabled === false ||
      (group.entry === undefined && group.wildcard?.enabled === false)
    ) {
      log?.info?.(`spectrum: drop group ${spaceKey} (disabled)`);
      return "blocked";
    }
    if (group.configured && !groupConfig) {
      log?.info?.(`spectrum: drop group ${spaceKey} (not in groups allowlist)`);
      return "blocked";
    }
  }
  const groupConfig = group ? (group.entry ?? group.wildcard) : undefined;

  const rawBody = normalized.text;
  const mentionRegexes = core.channel.mentions.buildMentionRegexes(config);
  const wasMentioned = rawBody
    ? core.channel.mentions.matchesMentionPatterns(rawBody, mentionRegexes)
    : false;
  const requireMention = isGroup ? (groupConfig?.requireMention ?? false) : false;
  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config,
    surface: CHANNEL_ID,
  });
  const hasControlCommand = rawBody ? core.channel.text.hasControlCommand(rawBody, config) : false;

  const { route, buildEnvelope } = resolveChannelInboundRouteEnvelope({
    cfg: config,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: chatType, id: spaceKey },
  });

  const pairing = createChannelPairingController({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });
  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const groupPolicy = account.config.groupPolicy ?? "allowlist";
  const groupAllowFrom = groupConfig?.allowFrom?.length
    ? groupConfig.allowFrom
    : account.config.groupAllowFrom;

  const access = await core.channel.inbound.ingress.resolveStable({
    channelId: CHANNEL_ID,
    accountId: account.accountId,
    identity: spectrumIngressIdentity,
    cfg: config,
    readStoreAllowFrom: async () => await pairing.readAllowFromStore(),
    subject: { stableId: senderKey },
    conversation: { kind: chatType, id: spaceKey },
    contextBinding: {
      agentId: route.agentId,
      sessionKey: route.sessionKey,
      messageId: message.id,
      inboundEventKind: "user_request",
    },
    mentionFacts: isGroup
      ? { canDetectMention: mentionRegexes.length > 0, wasMentioned, hasAnyMention: wasMentioned }
      : undefined,
    dmPolicy,
    groupPolicy,
    policy: {
      groupAllowFromFallbackToAllowFrom: true,
      activation: { requireMention, allowTextCommands },
    },
    allowFrom: account.config.allowFrom,
    groupAllowFrom,
    command: { allowTextCommands, hasControlCommand },
  });

  if (access.ingress.admission === "pairing-required") {
    await pairing.issueChallenge({
      senderId: senderKey,
      senderIdLine: `Your ${CHANNEL_LABEL} id: ${senderKey}`,
      meta: { platform },
      sendPairingReply: async (text) => {
        await space.send(text);
        params.statusSink?.({ lastOutboundAt: Date.now() });
      },
      onReplyError: (error) => {
        log?.error?.(`spectrum: pairing reply failed for ${senderKey}: ${String(error)}`);
      },
    });
    log?.info?.(`spectrum: pairing required for ${senderKey}`);
    return "pairing";
  }
  if (access.ingress.admission === "skip") {
    log?.info?.(`spectrum: skip ${spaceKey} (activation not met)`);
    return "skipped";
  }
  if (access.ingress.admission !== "dispatch") {
    log?.info?.(
      `spectrum: drop ${isGroup ? "group" : "DM"} sender ${senderKey} (${access.ingress.reasonCode})`,
    );
    return "blocked";
  }

  const media = await saveInboundAttachments({
    core,
    attachments: normalized.attachments,
    maxBytes: account.mediaMaxBytes,
    messageId: message.id,
    log,
  });
  const agentBody = rawBody || (media.length > 0 ? "<media:attachment>" : "");
  const fromLabel = isGroup ? spaceKey : senderKey;
  const body = buildEnvelope({
    channel: `${CHANNEL_LABEL} (${platform})`,
    from: fromLabel,
    timestamp,
    body: agentBody,
  });

  const ctxPayload = core.channel.inbound.buildContext({
    channelIngress: access,
    channel: CHANNEL_ID,
    accountId: route.accountId,
    provider: platform,
    messageId: message.id,
    messageIdFull: message.id,
    timestamp,
    from: senderKey,
    sender: { id: senderKey },
    conversation: {
      kind: chatType,
      id: spaceKey,
      label: fromLabel,
      nativeChannelId: space.id,
    },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
    },
    reply: { to: spaceKey, originatingTo: spaceKey },
    message: { body, bodyForAgent: agentBody, rawBody, commandBody: rawBody },
    media,
    access: {
      commands: { authorized: access.commandAccess.authorized },
      mentions: { canDetectMention: isGroup && mentionRegexes.length > 0, wasMentioned },
    },
    extra: {
      GroupSubject: isGroup ? spaceKey : undefined,
      GroupSystemPrompt: isGroup ? groupConfig?.systemPrompt : undefined,
    },
  });

  const typing = account.config.typingIndicator !== false;
  if (typing) {
    await space.startTyping().catch(() => undefined);
  }
  try {
    await core.channel.inbound.dispatch({
      cfg: config,
      channel: CHANNEL_ID,
      accountId: account.accountId,
      route: { agentId: route.agentId, sessionKey: route.sessionKey },
      ctxPayload,
      delivery: {
        deliver: async (payload) => {
          const mediaUrls = [payload.mediaUrl, ...(payload.mediaUrls ?? [])].filter(
            (url): url is string => typeof url === "string" && url.trim().length > 0,
          );
          await deliverToSpectrumSpace({
            space,
            text: payload.text,
            mediaUrls: Array.from(new Set(mediaUrls)),
            options: {
              markdown: account.config.markdown !== false,
              mediaMaxBytes: account.mediaMaxBytes,
            },
          });
          params.statusSink?.({ lastOutboundAt: Date.now() });
        },
        onError: (error, info) => {
          log?.error?.(`spectrum: ${info.kind} reply failed: ${String(error)}`);
        },
      },
      replyPipeline: {},
      replyOptions: {
        skillFilter: groupConfig?.skills,
      },
      record: {
        onRecordError: (error) => {
          log?.error?.(`spectrum: failed updating session meta: ${String(error)}`);
        },
      },
    });
  } finally {
    if (typing) {
      await space.stopTyping().catch(() => undefined);
    }
  }
  return "dispatched";
}
