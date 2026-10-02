import {
  buildBaseChannelStatusSummary,
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "openclaw/plugin-sdk/status-helpers";
import { DEFAULT_ACCOUNT_ID } from "./accounts.js";
import type { ResolvedSpectrumAccount } from "./types.js";

export const spectrumStatus = createComputedAccountStatusAdapter<ResolvedSpectrumAccount>({
  defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
  buildChannelSummary: ({ snapshot }) => ({
    ...buildBaseChannelStatusSummary(snapshot),
  }),
  resolveAccountSnapshot: ({ account }) => ({
    accountId: account.accountId,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    extra: {
      mode: account.projectId && account.projectSecret ? "cloud" : "direct",
      credentialSource: account.credentialSource,
      platforms: account.enabledPlatforms.join(",") || "[none]",
    },
  }),
});
