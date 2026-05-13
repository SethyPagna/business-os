const DEFAULT_REFRESH_CHANNELS = [
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

function normalizeRefreshChannels(channels) {
  return [...new Set(
    (Array.isArray(channels) ? channels : DEFAULT_REFRESH_CHANNELS)
      .map((channel) => String(channel || '').trim())
      .filter(Boolean),
  )]
}

export function refreshAppData(channels = DEFAULT_REFRESH_CHANNELS, detail = {}) {
  if (typeof window === 'undefined') return
  const normalizedChannels = normalizeRefreshChannels(channels)
  const extraDetail = detail && typeof detail === 'object' ? { ...detail } : {}
  normalizedChannels.forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, ts: Date.now(), ...extraDetail },
    }))
  })
}

export { DEFAULT_REFRESH_CHANNELS, normalizeRefreshChannels }
