import type { SettingsRefreshChannel, SettingsWriteOptions } from '../types/settingsContracts'

export function normalizeSettingsWriteOptions(options: SettingsWriteOptions = {}): Required<SettingsWriteOptions> {
  return {
    silentToast: options.silentToast === true,
    refreshChannels: Array.isArray(options.refreshChannels)
      ? options.refreshChannels.filter(Boolean) as SettingsRefreshChannel[]
      : [],
    reason: String(options.reason || '').trim(),
    source: String(options.source || '').trim(),
  }
}
