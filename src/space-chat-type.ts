import type { Space } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { inferSpectrumTargetChatType, type SpectrumChatType } from "./targets.js";

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
