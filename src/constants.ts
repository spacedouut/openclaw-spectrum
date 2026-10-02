export const CHANNEL_ID = "spectrum" as const;
export const CHANNEL_LABEL = "Photon Spectrum";

export const SPECTRUM_PLATFORMS = ["imessage", "telegram", "whatsapp_business", "slack"] as const;
export type SpectrumPlatform = (typeof SPECTRUM_PLATFORMS)[number];
