// Regenerates openclaw.plugin.json channelConfigs from the built zod schema.
import { readFile, writeFile } from "node:fs/promises";
import { spectrumChannelConfigSchema } from "../dist/config-schema.js";

const manifestUrl = new URL("../openclaw.plugin.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const { $schema: _ignored, ...schema } = spectrumChannelConfigSchema.schema;
manifest.channelConfigs = {
  spectrum: {
    schema,
    uiHints: spectrumChannelConfigSchema.uiHints,
  },
};
await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`);
