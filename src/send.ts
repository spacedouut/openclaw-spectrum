import { loadWebMedia } from "openclaw/plugin-sdk/web-media";
import {
  attachment,
  markdown,
  text as plainText,
  type ContentInput,
  type Space,
  type SpectrumInstance,
} from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { telegram } from "spectrum-ts/providers/telegram";
import { whatsappBusiness } from "spectrum-ts/providers/whatsapp-business";
import { resolveSpectrumAccount } from "./accounts.js";
import { getRunningSpectrumAccount, type RunningSpectrumAccount } from "./registry.js";
import { formatSpectrumTarget, parseSpectrumTarget, type SpectrumTarget } from "./targets.js";
import type { CoreConfig } from "./types.js";

type SpaceResolver = {
  get: (id: string) => Promise<Space>;
  create: (userId: string) => Promise<Space>;
};

type IMessageApp = SpectrumInstance<[ReturnType<typeof imessage.config>]>;
type TelegramApp = SpectrumInstance<[ReturnType<typeof telegram.config>]>;
type WhatsAppBusinessApp = SpectrumInstance<[ReturnType<typeof whatsappBusiness.config>]>;

/** Narrow the account app to a provider instance; only called for platforms we registered. */
function resolvePlatformSpaces(app: SpectrumInstance, platform: string): SpaceResolver | undefined {
  switch (platform) {
    case "imessage": {
      const instance = imessage(app as IMessageApp);
      return { get: (id) => instance.space.get(id), create: (id) => instance.space.create(id) };
    }
    case "telegram": {
      const instance = telegram(app as TelegramApp);
      return { get: (id) => instance.space.get(id), create: (id) => instance.space.create(id) };
    }
    case "whatsapp_business": {
      const instance = whatsappBusiness(app as WhatsAppBusinessApp);
      return { get: (id) => instance.space.get(id), create: (id) => instance.space.create(id) };
    }
    default:
      return undefined;
  }
}

export async function resolveSpectrumSpace(
  entry: RunningSpectrumAccount,
  target: SpectrumTarget,
): Promise<Space> {
  const cached = entry.spaces.get(formatSpectrumTarget(target));
  if (cached) {
    return cached;
  }
  if (!entry.platforms.has(target.platform)) {
    throw new Error(
      `Spectrum provider "${target.platform}" is not enabled for account "${entry.accountId}"`,
    );
  }
  const resolver = resolvePlatformSpaces(entry.app, target.platform);
  if (!resolver) {
    throw new Error(
      `Spectrum provider "${target.platform}" only supports replying to conversations that have messaged the agent`,
    );
  }
  return target.kind === "user" ? await resolver.create(target.id) : await resolver.get(target.id);
}

export type SpectrumMediaAccess = {
  mediaLocalRoots?: readonly string[];
  mediaReadFile?: (filePath: string) => Promise<Buffer>;
};

export type SpectrumDeliverOptions = SpectrumMediaAccess & {
  markdown: boolean;
  mediaMaxBytes?: number;
};

export function buildTextContent(value: string, useMarkdown: boolean): ContentInput {
  return useMarkdown ? markdown(value) : plainText(value);
}

export async function loadSpectrumAttachment(
  mediaUrl: string,
  options: SpectrumDeliverOptions,
): Promise<ContentInput> {
  const media = await loadWebMedia(mediaUrl, {
    maxBytes: options.mediaMaxBytes,
    optimizeImages: false,
    ...(options.mediaLocalRoots ? { localRoots: options.mediaLocalRoots } : {}),
    ...(options.mediaReadFile ? { readFile: options.mediaReadFile } : {}),
  });
  return attachment(media.buffer, {
    ...(media.contentType ? { mimeType: media.contentType } : {}),
    ...(media.fileName ? { name: media.fileName } : {}),
  });
}

/**
 * Send text and media to a Spectrum space. Media is loaded before anything is sent; Spectrum
 * delivers items sequentially (variadic `send` too), so a later failure leaves earlier items sent.
 */
export async function deliverToSpectrumSpace(params: {
  space: Space;
  text?: string;
  mediaUrls?: readonly string[];
  options: SpectrumDeliverOptions;
}): Promise<{ messageId?: string }> {
  const contents: ContentInput[] = [];
  for (const mediaUrl of params.mediaUrls ?? []) {
    contents.push(await loadSpectrumAttachment(mediaUrl, params.options));
  }
  const body = params.text?.trim();
  if (body) {
    contents.unshift(buildTextContent(body, params.options.markdown));
  }
  let messageId: string | undefined;
  for (const content of contents) {
    const sent = await params.space.send(content);
    messageId = sent?.id ?? messageId;
  }
  return { messageId };
}

function requireRunningAccount(accountId: string): RunningSpectrumAccount {
  const entry = getRunningSpectrumAccount(accountId);
  if (!entry) {
    throw new Error(`Spectrum account "${accountId}" is not running`);
  }
  return entry;
}

export async function sendSpectrumMessage(
  params: {
    cfg: CoreConfig;
    accountId?: string | null;
    to: string;
    text?: string;
    mediaUrls?: readonly string[];
  } & SpectrumMediaAccess,
): Promise<{ to: string; messageId: string }> {
  const account = resolveSpectrumAccount({ cfg: params.cfg, accountId: params.accountId });
  const target = parseSpectrumTarget(params.to);
  if (!target) {
    throw new Error(
      `Invalid Spectrum target "${params.to}"; expected <platform>:<spaceId> or <platform>:user:<userId>`,
    );
  }
  const entry = requireRunningAccount(account.accountId);
  const space = await resolveSpectrumSpace(entry, target);
  const { messageId } = await deliverToSpectrumSpace({
    space,
    text: params.text,
    mediaUrls: params.mediaUrls,
    options: {
      markdown: account.config.markdown !== false,
      mediaMaxBytes: account.mediaMaxBytes,
      mediaLocalRoots: params.mediaLocalRoots,
      mediaReadFile: params.mediaReadFile,
    },
  });
  return { to: formatSpectrumTarget(target), messageId: messageId ?? "" };
}
