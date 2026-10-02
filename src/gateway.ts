import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import type { Message, Space } from "spectrum-ts";
import { handleSpectrumInbound } from "./inbound.js";
import { createSpectrumApp, type SpectrumAppFactory } from "./providers.js";
import {
  registerRunningSpectrumAccount,
  unregisterRunningSpectrumAccount,
  type RunningSpectrumAccount,
} from "./registry.js";
import { getSpectrumRuntime } from "./runtime.js";
import type { CoreConfig, ResolvedSpectrumAccount } from "./types.js";

export type SpectrumGatewayDeps = {
  createApp: SpectrumAppFactory;
  getCore: () => PluginRuntime;
  handleInbound: typeof handleSpectrumInbound;
};

const defaultDeps: SpectrumGatewayDeps = {
  createApp: createSpectrumApp,
  getCore: getSpectrumRuntime,
  handleInbound: handleSpectrumInbound,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run one Spectrum app for an account until the gateway aborts it. */
export async function startSpectrumGatewayAccount(
  ctx: ChannelGatewayContext<ResolvedSpectrumAccount>,
  deps: SpectrumGatewayDeps = defaultDeps,
): Promise<void> {
  const account = ctx.account;
  if (!account.configured) {
    throw new Error(
      `Spectrum account "${account.accountId}" is not configured; enable at least one provider`,
    );
  }
  const core = deps.getCore();
  const log = {
    info: (message: string) => ctx.log?.info?.(message),
    error: (message: string) => ctx.log?.error?.(message),
  };
  ctx.setStatus({
    accountId: account.accountId,
    running: true,
    lifecycle: "starting",
    configured: true,
    enabled: account.enabled,
  });

  const app = await deps.createApp(account);
  if (ctx.abortSignal.aborted) {
    await app.stop().catch((error: unknown) => {
      log.error(`spectrum: stop failed for ${account.accountId}: ${errorMessage(error)}`);
    });
    ctx.setStatus({
      ...ctx.getStatus(),
      accountId: account.accountId,
      running: false,
      connected: false,
      lifecycle: "stopped",
      lastStopAt: Date.now(),
    });
    return;
  }
  const entry: RunningSpectrumAccount = {
    accountId: account.accountId,
    app,
    platforms: new Set(account.enabledPlatforms),
    spaces: new Map(),
  };
  registerRunningSpectrumAccount(entry);

  let stopping: Promise<void> | undefined;
  const stopApp = () => {
    stopping ??= app.stop().catch((error: unknown) => {
      log.error(`spectrum: stop failed for ${account.accountId}: ${errorMessage(error)}`);
    });
    return stopping;
  };
  const onAbort = () => {
    void stopApp();
  };
  ctx.abortSignal.addEventListener("abort", onAbort, { once: true });

  const spaceQueues = new Map<string, Promise<void>>();
  const enqueue = (space: Space, message: Message) => {
    const key = `${message.platform}:${space.id}`;
    const previous = spaceQueues.get(key) ?? Promise.resolve();
    const next = previous
      .then(async () => {
        await deps.handleInbound({
          core,
          cfg: ctx.cfg as CoreConfig,
          account,
          entry,
          space,
          message,
          log,
          statusSink: (patch) => ctx.setStatus({ ...ctx.getStatus(), ...patch }),
        });
      })
      .catch((error: unknown) => {
        log.error(`spectrum: inbound handling failed: ${errorMessage(error)}`);
      })
      .finally(() => {
        if (spaceQueues.get(key) === next) {
          spaceQueues.delete(key);
        }
      });
    spaceQueues.set(key, next);
  };

  ctx.setStatus({
    ...ctx.getStatus(),
    accountId: account.accountId,
    running: true,
    connected: true,
    lifecycle: "ready",
    lastStartAt: Date.now(),
    lastError: null,
  });

  try {
    if (!ctx.abortSignal.aborted) {
      for await (const [space, message] of app.messages) {
        if (ctx.abortSignal.aborted) {
          break;
        }
        if (message.direction === "outbound") {
          continue;
        }
        enqueue(space, message);
      }
    }
  } catch (error) {
    if (!ctx.abortSignal.aborted) {
      ctx.setStatus({
        ...ctx.getStatus(),
        accountId: account.accountId,
        connected: false,
        lifecycle: "recovering",
        lastError: errorMessage(error),
      });
      throw error;
    }
  } finally {
    ctx.abortSignal.removeEventListener("abort", onAbort);
    await Promise.allSettled(spaceQueues.values());
    await stopApp();
    unregisterRunningSpectrumAccount(entry);
    ctx.setStatus({
      ...ctx.getStatus(),
      accountId: account.accountId,
      running: false,
      connected: false,
      lifecycle: "stopped",
      lastStopAt: Date.now(),
    });
  }
}
