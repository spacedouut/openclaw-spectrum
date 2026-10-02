import { Spectrum, type PlatformProviderConfig, type SpectrumInstance } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { slack } from "spectrum-ts/providers/slack";
import { telegram } from "spectrum-ts/providers/telegram";
import { whatsappBusiness } from "spectrum-ts/providers/whatsapp-business";
import type { ResolvedSpectrumAccount, ResolvedSpectrumProviders } from "./types.js";

/** Build the Spectrum `providers` array for one account. */
export function buildSpectrumProviders(
  providers: ResolvedSpectrumProviders,
): PlatformProviderConfig[] {
  const configs: PlatformProviderConfig[] = [];
  if (providers.imessage) {
    configs.push(imessage.config(providers.imessage));
  }
  if (providers.telegram) {
    configs.push(telegram.config(providers.telegram));
  }
  if (providers.whatsappBusiness) {
    configs.push(whatsappBusiness.config(providers.whatsappBusiness));
  }
  if (providers.slack) {
    configs.push(slack.config(providers.slack));
  }
  return configs;
}

export type SpectrumAppFactory = (account: ResolvedSpectrumAccount) => Promise<SpectrumInstance>;

export const createSpectrumApp: SpectrumAppFactory = async (account) => {
  const providers = buildSpectrumProviders(account.providers);
  if (providers.length === 0) {
    throw new Error(`Spectrum account "${account.accountId}" has no enabled providers`);
  }
  if (account.projectId && account.projectSecret) {
    return await Spectrum({
      projectId: account.projectId,
      projectSecret: account.projectSecret,
      providers,
    });
  }
  return await Spectrum({ providers });
};
