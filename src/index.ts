import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { spectrumPlugin } from "./channel.js";
import { CHANNEL_ID, CHANNEL_LABEL } from "./constants.js";
import { setSpectrumRuntime } from "./runtime.js";

export { spectrumPlugin } from "./channel.js";
export { setSpectrumRuntime } from "./runtime.js";
export type { ResolvedSpectrumAccount, SpectrumAccountConfig } from "./types.js";

export default defineChannelPluginEntry({
  id: CHANNEL_ID,
  name: CHANNEL_LABEL,
  description: "OpenClaw channel plugin for Photon Spectrum (iMessage, Telegram, and more)",
  plugin: spectrumPlugin,
  setRuntime: setSpectrumRuntime,
});
