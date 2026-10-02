import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import type { ChannelAccountSnapshot, ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import { describe, expect, it, vi } from "vitest";
import { resolveSpectrumAccount } from "../src/accounts.js";
import { startSpectrumGatewayAccount, type SpectrumGatewayDeps } from "../src/gateway.js";
import { getRunningSpectrumAccount } from "../src/registry.js";
import type { CoreConfig, ResolvedSpectrumAccount } from "../src/types.js";
import { createFakeApp, createFakeMessage, createFakeSpace } from "./fakes.js";

const cfg: CoreConfig = { channels: { spectrum: { providers: { telegram: true } } } };

function createCtx(account: ResolvedSpectrumAccount) {
  const abort = new AbortController();
  const statuses: ChannelAccountSnapshot[] = [];
  let status: ChannelAccountSnapshot = { accountId: account.accountId };
  const ctx = {
    cfg,
    accountId: account.accountId,
    account,
    runtime: { log: () => undefined, error: () => undefined, exit: () => undefined },
    abortSignal: abort.signal,
    getStatus: () => status,
    setStatus: (next: ChannelAccountSnapshot) => {
      status = next;
      statuses.push(next);
    },
  } as unknown as ChannelGatewayContext<ResolvedSpectrumAccount>;
  return { ctx, abort, statuses };
}

describe("startSpectrumGatewayAccount", () => {
  it("dispatches inbound messages, skips outbound ones, and stops on abort", async () => {
    const account = resolveSpectrumAccount({ cfg, env: {} });
    const fake = createFakeApp();
    const handleInbound = vi.fn<SpectrumGatewayDeps["handleInbound"]>(async () => "dispatched");
    const deps: SpectrumGatewayDeps = {
      createApp: async () => fake.app,
      getCore: () => ({}) as PluginRuntime,
      handleInbound,
    };
    const { ctx, abort, statuses } = createCtx(account);
    const running = startSpectrumGatewayAccount(ctx, deps);
    await vi.waitFor(() => expect(getRunningSpectrumAccount("default")).toBeDefined());

    const { space } = createFakeSpace("42");
    fake.push(space, createFakeMessage({ space, direction: "outbound", id: "o1" }));
    fake.push(space, createFakeMessage({ space, id: "i1" }));
    await vi.waitFor(() => expect(handleInbound).toHaveBeenCalledTimes(1));
    expect(handleInbound.mock.calls[0]?.[0]).toMatchObject({ message: { id: "i1" } });

    abort.abort();
    await running;
    expect(fake.stopped).toBe(1);
    expect(getRunningSpectrumAccount("default")).toBeUndefined();
    expect(statuses.map((s) => s.lifecycle)).toEqual(["starting", "ready", "stopped"]);
    expect(statuses.at(-1)).toMatchObject({ running: false, connected: false });
  });

  it("refuses to start an unconfigured account", async () => {
    const account = resolveSpectrumAccount({ cfg: { channels: { spectrum: {} } }, env: {} });
    const { ctx } = createCtx(account);
    await expect(startSpectrumGatewayAccount(ctx)).rejects.toThrow(/not configured/);
  });
});
