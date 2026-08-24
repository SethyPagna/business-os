export const DEFAULT_REFRESH_CHANNELS = [
  'settings',
  'products',
  'inventory',
  'sales',
  'returns',
  'customers',
  'suppliers',
  // Was 'delivery_contacts' (snake_case) -- didn't match the real channel
  // name broadcast by the backend (routes/contacts.ts's per-tab config)
  // or the camelCase name every listener actually checks for
  // (DeliveryTab.tsx, POS.tsx's deliveryContacts branch), so a full
  // "refresh everything" call (e.g. after a data reset) silently never
  // refreshed an open Delivery Contacts tab. Fixed to match.
  'deliveryContacts',
  'branches',
  'dashboard',
  'catalog',
  'files',
  'audit_log',
  'users',
  // Real backend broadcast channels (see cloudflare/src/routes/lookups.ts,
  // fees.ts, notifications.ts's device-decision broadcast, portal.ts's
  // submission broadcast, promotions.ts, users.ts's roles broadcast) that
  // were missing from this list entirely, so a full refresh call skipped
  // them even though every other real channel was covered.
  'categories',
  'units',
  'fees',
  'notifications',
  'portalSubmissions',
  'promotions',
  'roles',
  'pendingActions',
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
