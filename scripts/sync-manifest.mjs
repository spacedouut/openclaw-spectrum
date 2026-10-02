// Regenerates openclaw.plugin.json channelConfigs from the built zod schema and
// package.json openclaw.channel.setup from the built setup contract.
import { readFile, writeFile } from "node:fs/promises";
import { spectrumChannelConfigSchema } from "../dist/config-schema.js";
import { spectrumSetupContract } from "../dist/setup-surface.js";

async function updateJson(url, update) {
  const json = JSON.parse(await readFile(url, "utf8"));
  update(json);
  await writeFile(url, `${JSON.stringify(json, null, 2)}\n`);
}

await updateJson(new URL("../openclaw.plugin.json", import.meta.url), (manifest) => {
  const { $schema: _ignored, ...schema } = spectrumChannelConfigSchema.schema;
  manifest.channelConfigs = {
    spectrum: {
      schema,
      uiHints: spectrumChannelConfigSchema.uiHints,
    },
  };
});

await updateJson(new URL("../package.json", import.meta.url), (pkg) => {
  pkg.openclaw.channel.setup = { fields: spectrumSetupContract.metadata.fields };
});
