import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import { describe, expect, it, vi } from "vitest";
import { resolveSpectrumAccount } from "../src/accounts.js";
import { handleSpectrumInbound } from "../src/inbound.js";
import type { RunningSpectrumAccount } from "../src/registry.js";
import type { CoreConfig } from "../src/types.js";
import { createFakeApp, createFakeMessage, createFakeSpace } from "./fakes.js";

const cfg: CoreConfig = {
  channels: { spectrum: { providers: { telegram: true }, allowFrom: ["telegram:42"] } },
};

function createCore(admission: "dispatch" | "pairing-required" | "drop") {
  const resolveStable = vi.fn(async (_params: Record<string, unknown>) => ({
    ingress: { admission, reasonCode: "allowed", decisiveGateId: "dm" },
    commandAccess: { authorized: true },
  }));
  const buildContext = vi.fn((params: Record<string, unknown>) => ({ built: params }));
  const dispatch = vi.fn(
    async (params: { delivery: { deliver: (payload: { text?: string }) => Promise<void> } }) => {
      await params.delivery.deliver({ text: "agent reply" });
    },
  );
  const upsertPairingRequest = vi.fn(async () => ({ code: "ABC123", created: true }));
  const core = {
    channel: {
      mentions: { buildMentionRegexes: () => [], matchesMentionPatterns: () => false },
      commands: { shouldHandleTextCommands: () => true },
      text: { hasControlCommand: () => false },
      inbound: { ingress: { resolveStable }, buildContext, dispatch },
      media: { saveMediaBuffer: vi.fn() },
      pairing: {
        readAllowFromStore: async () => [],
        upsertPairingRequest,
        buildPairingReply: ({ code }: { code: string }) => `pair with ${code}`,
      },
    },
  } as unknown as PluginRuntime;
  return { core, resolveStable, buildContext, dispatch, upsertPairingRequest };
}

function createEntry(): RunningSpectrumAccount {
  return {
    accountId: "default",
    app: createFakeApp().app,
    platforms: new Set(["telegram"]),
    spaces: new Map(),
  };
}

describe("handleSpectrumInbound", () => {
  it("routes a DM through ingress, builds context, and replies via the space", async () => {
    const { core, resolveStable, buildContext, dispatch } = createCore("dispatch");
    const { space, sent, typing } = createFakeSpace("42");
    const entry = createEntry();
    const outcome = await handleSpectrumInbound({
      core,
      cfg,
      account: resolveSpectrumAccount({ cfg, env: {} }),
      entry,
      space,
      message: createFakeMessage({ space, text: "hi there" }),
    });
    expect(outcome).toBe("dispatched");
    expect(resolveStable.mock.calls[0]?.[0]).toMatchObject({
      channelId: "spectrum",
      subject: { stableId: "telegram:42" },
      conversation: { kind: "direct", id: "telegram:42" },
      allowFrom: ["telegram:42"],
    });
    expect(buildContext.mock.calls[0]?.[0]).toMatchObject({
      channel: "spectrum",
      provider: "telegram",
      from: "telegram:42",
      conversation: { kind: "direct", id: "telegram:42", nativeChannelId: "42" },
      reply: { to: "telegram:42" },
      message: { rawBody: "hi there", bodyForAgent: "hi there" },
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ type: "markdown", markdown: "agent reply" }]);
    expect(typing).toEqual(["start", "stop"]);
    expect(entry.spaces.has("telegram:42")).toBe(true);
  });

  it("detects Telegram groups and ignores outbound/agent messages", async () => {
    const { core, resolveStable } = createCore("dispatch");
    const group = createFakeSpace("-100555");
    await handleSpectrumInbound({
      core,
      cfg,
      account: resolveSpectrumAccount({ cfg, env: {} }),
      entry: createEntry(),
      space: group.space,
      message: createFakeMessage({ space: group.space }),
    });
    expect(resolveStable.mock.calls[0]?.[0]).toMatchObject({
      conversation: { kind: "group", id: "telegram:-100555" },
      groupPolicy: "allowlist",
    });
    const outbound = await handleSpectrumInbound({
      core,
      cfg,
      account: resolveSpectrumAccount({ cfg, env: {} }),
      entry: createEntry(),
      space: group.space,
      message: createFakeMessage({ space: group.space, direction: "outbound" }),
    });
    expect(outbound).toBe("ignored");
  });

  it("issues a pairing challenge instead of dispatching", async () => {
    const { core, dispatch, upsertPairingRequest } = createCore("pairing-required");
    const { space, sent } = createFakeSpace("77");
    const outcome = await handleSpectrumInbound({
      core,
      cfg,
      account: resolveSpectrumAccount({ cfg, env: {} }),
      entry: createEntry(),
      space,
      message: createFakeMessage({ space, senderId: "77" }),
    });
    expect(outcome).toBe("pairing");
    expect(upsertPairingRequest).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });

  it("drops blocked senders and groups outside the groups allowlist", async () => {
    const blocked = createCore("drop");
    const { space } = createFakeSpace("99");
    expect(
      await handleSpectrumInbound({
        core: blocked.core,
        cfg,
        account: resolveSpectrumAccount({ cfg, env: {} }),
        entry: createEntry(),
        space,
        message: createFakeMessage({ space, senderId: "99" }),
      }),
    ).toBe("blocked");
    expect(blocked.dispatch).not.toHaveBeenCalled();

    const groupCfg: CoreConfig = {
      channels: {
        spectrum: { providers: { telegram: true }, groups: { "telegram:-1001": {} } },
      },
    };
    const allowed = createCore("dispatch");
    const other = createFakeSpace("-1002");
    expect(
      await handleSpectrumInbound({
        core: allowed.core,
        cfg: groupCfg,
        account: resolveSpectrumAccount({ cfg: groupCfg, env: {} }),
        entry: createEntry(),
        space: other.space,
        message: createFakeMessage({ space: other.space }),
      }),
    ).toBe("blocked");
    expect(allowed.resolveStable).not.toHaveBeenCalled();
  });
});
