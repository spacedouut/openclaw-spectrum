import type { Space, SpectrumInstance } from "spectrum-ts";
import { formatSpectrumTarget } from "./targets.js";

export type RunningSpectrumAccount = {
  accountId: string;
  app: SpectrumInstance;
  platforms: ReadonlySet<string>;
  spaces: Map<string, Space>;
};

const MAX_CACHED_SPACES = 1_000;
const running = new Map<string, RunningSpectrumAccount>();

export function registerRunningSpectrumAccount(entry: RunningSpectrumAccount): void {
  running.set(entry.accountId, entry);
}

export function unregisterRunningSpectrumAccount(entry: RunningSpectrumAccount): void {
  if (running.get(entry.accountId) === entry) {
    running.delete(entry.accountId);
  }
}

export function getRunningSpectrumAccount(accountId: string): RunningSpectrumAccount | undefined {
  return running.get(accountId);
}

/** Remember live spaces from inbound traffic so replies and proactive sends can reuse them. */
export function rememberSpectrumSpace(
  entry: RunningSpectrumAccount,
  platform: string,
  space: Space,
): string {
  const key = formatSpectrumTarget({ platform, kind: "space", id: space.id });
  entry.spaces.delete(key);
  entry.spaces.set(key, space);
  if (entry.spaces.size > MAX_CACHED_SPACES) {
    const oldest = entry.spaces.keys().next().value;
    if (oldest !== undefined) {
      entry.spaces.delete(oldest);
    }
  }
  return key;
}
