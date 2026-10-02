import type { Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { CHANNEL_ID } from "./constants.js";

export type SpectrumTargetKind = "space" | "user";

export type SpectrumTarget = {
  platform: string;
  kind: SpectrumTargetKind;
  id: string;
};

export type SpectrumChatType = "direct" | "group";

const PLATFORM_ALIASES: Record<string, string> = {
  imessage: "imessage",
  imsg: "imessage",
  sms: "imessage",
  telegram: "telegram",
  tg: "telegram",
  whatsapp: "whatsapp_business",
  wa: "whatsapp_business",
  whatsapp_business: "whatsapp_business",
  "whatsapp-business": "whatsapp_business",
  whatsappbusiness: "whatsapp_business",
  slack: "slack",
};

export function resolveSpectrumPlatform(raw: string): string | undefined {
  return PLATFORM_ALIASES[raw.trim().toLowerCase()];
}

/**
 * Parse `<platform>:<spaceId>` or `<platform>:user:<userId>` (optionally prefixed with
 * `spectrum:`). Only the first `:` separates the platform; space ids may contain colons.
 */
export function parseSpectrumTarget(raw: string): SpectrumTarget | null {
  let value = raw.trim();
  const channelPrefix = `${CHANNEL_ID}:`;
  if (value.toLowerCase().startsWith(channelPrefix)) {
    value = value.slice(channelPrefix.length);
  }
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return null;
  }
  const platform = resolveSpectrumPlatform(value.slice(0, separator));
  if (!platform) {
    return null;
  }
  let rest = value.slice(separator + 1).trim();
  let kind: SpectrumTargetKind = "space";
  const lowered = rest.toLowerCase();
  if (lowered.startsWith("user:")) {
    kind = "user";
    rest = rest.slice("user:".length).trim();
  } else if (lowered.startsWith("space:")) {
    rest = rest.slice("space:".length).trim();
  }
  if (!rest) {
    return null;
  }
  return { platform, kind, id: rest };
}

export function formatSpectrumTarget(target: SpectrumTarget): string {
  return target.kind === "user"
    ? `${target.platform}:user:${target.id}`
    : `${target.platform}:${target.id}`;
}

export function normalizeSpectrumTarget(raw: string): string | undefined {
  const parsed = parseSpectrumTarget(raw);
  return parsed ? formatSpectrumTarget(parsed) : undefined;
}

/** Stable sender key used for allowlists and pairing: `<platform>:<userId>`. */
export function formatSpectrumSenderKey(platform: string, userId: string): string {
  return `${platform}:${userId}`;
}

export function normalizeSpectrumSenderKey(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }
  if (value === "*") {
    return value;
  }
  const parsed = parseSpectrumTarget(value);
  if (!parsed) {
    return undefined;
  }
  return formatSpectrumSenderKey(parsed.platform, parsed.id);
}

/** Best-effort chat type for a known space id when no live space object is available. */
export function inferSpectrumTargetChatType(target: SpectrumTarget): SpectrumChatType {
  if (target.kind === "user") {
    return "direct";
  }
  switch (target.platform) {
    case "imessage":
      return target.id.includes(";+;") ? "group" : "direct";
    case "telegram":
      return target.id.startsWith("-") ? "group" : "direct";
    case "slack":
      return target.id.startsWith("D") ? "direct" : "group";
    default:
      return "direct";
  }
}

export function resolveSpaceChatType(params: {
  platform: string;
  space: Space;
  senderId?: string;
}): SpectrumChatType {
  if (imessage.is(params.space)) {
    return params.space.type === "group" ? "group" : "direct";
  }
  switch (params.platform) {
    case "telegram":
    case "slack":
    case "whatsapp_business":
      return inferSpectrumTargetChatType({
        platform: params.platform,
        kind: "space",
        id: params.space.id,
      });
    default:
      return params.senderId !== undefined && params.senderId === params.space.id
        ? "direct"
        : "group";
  }
}
