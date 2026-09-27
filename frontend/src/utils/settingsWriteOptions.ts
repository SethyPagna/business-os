import type { SettingsRefreshChannel, SettingsWriteOptions } from '../types/settingsContracts'

export function normalizeSettingsWriteOptions(options: SettingsWriteOptions = {}): Required<SettingsWriteOptions> {
  return {
    clearKeys: Array.isArray(options.clearKeys)
      ? options.clearKeys.filter((key): key is string => typeof key === 'string' && key !== '')
      : [],
    silentToast: options.silentToast === true,
    refreshChannels: Array.isArray(options.refreshChannels)
      ? options.refreshChannels.filter(Boolean) as SettingsRefreshChannel[]
      : [],
    reason: String(options.reason || '').trim(),
    skipExpectedUpdatedAt: options.skipExpectedUpdatedAt === true,
    source: String(options.source || '').trim(),
  }
}
