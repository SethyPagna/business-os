export const SETTINGS_REFRESH_CHANNELS = [
  'settings',
  'products',
  'inventory',
  'sales',
  'returns',
  'customers',
  'suppliers',
  'delivery_contacts',
  'branches',
  'dashboard',
  'catalog',
  'files',
  'audit_log',
  'users',
  'pos',
] as const

export type SettingsRefreshChannel = (typeof SETTINGS_REFRESH_CHANNELS)[number]

export interface SettingsWriteOptions {
  // Keys the save blanks on purpose (api/settingsTransport.ts saveSettingsOnce).
  clearKeys?: string[]
  silentToast?: boolean
  refreshChannels?: SettingsRefreshChannel[]
  reason?: string
  skipExpectedUpdatedAt?: boolean
  source?: string
}
