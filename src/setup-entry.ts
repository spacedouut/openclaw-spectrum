import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { spectrumSetupPlugin } from "./setup-surface.js";

export default defineSetupPluginEntry(spectrumSetupPlugin);
