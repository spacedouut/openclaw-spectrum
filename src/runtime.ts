import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const store = createPluginRuntimeStore<PluginRuntime>(
  "Photon Spectrum runtime is not initialized; load the plugin through OpenClaw",
);

export const setSpectrumRuntime = store.setRuntime;
export const getSpectrumRuntime = store.getRuntime;
export const tryGetSpectrumRuntime = store.tryGetRuntime;
