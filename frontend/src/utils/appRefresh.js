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

export function refreshAppData(channels = DEFAULT_REFRESH_CHANNELS) {
  if (typeof window === 'undefined') return
  ;(Array.isArray(channels) ? channels : DEFAULT_REFRESH_CHANNELS).forEach((channel) => {
    window.dispatchEvent(new CustomEvent('sync:update', {
      detail: { channel, ts: Date.now() },
    }))
  })
}

export { DEFAULT_REFRESH_CHANNELS }
