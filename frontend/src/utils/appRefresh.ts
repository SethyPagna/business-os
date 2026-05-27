export const DEFAULT_REFRESH_CHANNELS = [
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
]

type RefreshDetail = Record<string, unknown>

export function normalizeRefreshChannels(channels: unknown = DEFAULT_REFRESH_CHANNELS): string[] {
  return [...new Set(
    (Array.isArray(channels) ? channels : DEFAULT_REFRESH_CHANNELS)
      .map((channel) => String(channel || '').trim())
      .filter(Boolean),
  )]
}

export function refreshAppData(channels: unknown = DEFAULT_REFRESH_CHANNELS, detail: RefreshDetail = {}): void {
  if (typeof window === 'undefined') return
  const normalizedChannels = normalizeRefreshChannels(channels)
  const extraDetail = detail && typeof detail === 'object' ? { ...detail } : {}
  normalizedChannels.forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, ts: Date.now(), ...extraDetail },
    }))
  })
}
