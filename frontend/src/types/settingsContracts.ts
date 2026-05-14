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
  silentToast?: boolean
  refreshChannels?: SettingsRefreshChannel[]
  reason?: string
  source?: string
}
