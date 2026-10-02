import type { Message, Space, SpectrumInstance } from "spectrum-ts";

export type SentContent = { type: string; [key: string]: unknown };

export function createFakeSpace(id: string, platform = "telegram") {
  const sent: SentContent[] = [];
  const typing: string[] = [];
  const space = {
    __platform: platform,
    id,
    async send(...contents: unknown[]) {
      const results = [];
      for (const content of contents) {
        const built =
          typeof content === "string"
            ? { type: "text", text: content }
            : await (content as { build: () => Promise<SentContent> }).build();
        sent.push(built);
        results.push({ id: `out-${sent.length}` });
      }
      return contents.length === 1 ? results[0] : results;
    },
    async responding<T>(fn: () => T | Promise<T>) {
      return await fn();
    },
    async startTyping() {
      typing.push("start");
    },
    async stopTyping() {
      typing.push("stop");
    },
  };
  return { space: space as unknown as Space, sent, typing };
}

export function createFakeMessage(params: {
  space: Space;
  platform?: string;
  senderId?: string;
  text?: string;
  direction?: "inbound" | "outbound";
  id?: string;
}): Message {
  return {
    id: params.id ?? "m1",
    platform: params.platform ?? "telegram",
    direction: params.direction ?? "inbound",
    sender: { __platform: params.platform ?? "telegram", id: params.senderId ?? "42" },
    space: params.space,
    timestamp: new Date(1_700_000_000_000),
    content: { type: "text", text: params.text ?? "hello" },
    reply: async () => undefined,
  } as unknown as Message;
}

/** Async-iterable fake Spectrum app driven by `push` / `end`. */
export function createFakeApp() {
  const queue: Array<[Space, Message]> = [];
  let wake: (() => void) | undefined;
  let done = false;
  let stopped = 0;
  const app = {
    messages: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const next = queue.shift();
          if (next) {
            yield next;
            continue;
          }
          if (done) {
            return;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    },
    async stop() {
      stopped += 1;
      done = true;
      wake?.();
    },
  };
  return {
    app: app as unknown as SpectrumInstance,
    push(space: Space, message: Message) {
      queue.push([space, message]);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
    get stopped() {
      return stopped;
    },
  };
}
