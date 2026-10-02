import type { Message } from "spectrum-ts";

export type SpectrumInboundAttachment = {
  name?: string;
  mimeType: string;
  size?: number;
  read: () => Promise<Buffer>;
};

export type NormalizedSpectrumInbound = {
  text: string;
  attachments: SpectrumInboundAttachment[];
};

type Content = Message["content"];

const IGNORED_CONTENT_TYPES = new Set<string>([
  "typing",
  "read",
  "reaction",
  "edit",
  "unsend",
  "rename",
  "avatar",
  "addMember",
  "removeMember",
  "leaveSpace",
  "poll_option",
]);

function describeContact(content: Extract<Content, { type: "contact" }>): string {
  const name =
    content.name?.formatted ??
    [content.name?.first, content.name?.last].filter(Boolean).join(" ").trim();
  const phones = content.phones?.map((phone) => phone.value) ?? [];
  const emails = content.emails?.map((email) => email.value) ?? [];
  const details = [...phones, ...emails].join(", ");
  return `[Contact${name ? `: ${name}` : ""}${details ? ` (${details})` : ""}]`;
}

function collect(content: Content, out: NormalizedSpectrumInbound, textParts: string[]): void {
  switch (content.type) {
    case "text":
      textParts.push(content.text);
      return;
    case "markdown":
      textParts.push(content.markdown);
      return;
    case "attachment":
      out.attachments.push({
        name: content.name,
        mimeType: content.mimeType,
        size: content.size,
        read: content.read,
      });
      return;
    case "voice":
      out.attachments.push({
        name: content.name,
        mimeType: content.mimeType,
        size: content.size,
        read: content.read,
      });
      return;
    case "richlink":
      textParts.push(content.url);
      return;
    case "contact":
      textParts.push(describeContact(content));
      return;
    case "poll":
      textParts.push(
        `[Poll: ${content.title}${
          content.options.length
            ? ` — ${content.options.map((option) => option.title).join(" / ")}`
            : ""
        }]`,
      );
      return;
    case "reply":
      collect(content.content, out, textParts);
      return;
    case "effect":
      collect(content.content, out, textParts);
      return;
    case "group":
      for (const item of content.items) {
        if (item.direction !== "outbound") {
          collect(item.content, out, textParts);
        }
      }
      return;
    default:
      return;
  }
}

/**
 * Flatten Spectrum message content into agent text plus downloadable attachments.
 * Returns `null` for control/state events that should not start an agent turn.
 */
export function normalizeSpectrumContent(content: Content): NormalizedSpectrumInbound | null {
  if (IGNORED_CONTENT_TYPES.has(content.type)) {
    return null;
  }
  const out: NormalizedSpectrumInbound = { text: "", attachments: [] };
  const textParts: string[] = [];
  collect(content, out, textParts);
  out.text = textParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
  if (!out.text && out.attachments.length === 0) {
    return null;
  }
  return out;
}
