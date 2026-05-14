import { normalizeRefreshChannels } from './appRefresh.js'

export const CATEGORY_REFRESH_CHANNELS = normalizeRefreshChannels(['categories', 'products', 'inventory'])
export const UNIT_REFRESH_CHANNELS = normalizeRefreshChannels(['units', 'products', 'inventory'])

const SETTINGS_CHANNEL_RULES = [
  {
    keys: ['product_brand_options', 'product_brand_color_map'],
    channels: ['settings', 'products', 'inventory', 'pos'],
  },
  {
    keys: ['receipt_template'],
    channels: ['settings', 'sales', 'pos'],
  },
  {
    keys: ['pos_payment_methods'],
    channels: ['settings', 'sales', 'pos'],
  },
]

function normalizeSettingKeys(updates = {}) {
  return [...new Set(
    Object.keys(updates || {})
      .map((key) => String(key || '').trim())
      .filter(Boolean),
  )]
}

export function getSettingsRefreshChannels(updates = {}, explicitChannels = []) {
  const normalizedExplicit = normalizeRefreshChannels(explicitChannels)
  if (normalizedExplicit.length) return normalizedExplicit

  const keys = normalizeSettingKeys(updates)
  if (!keys.length) return ['settings']

  const channels = new Set(['settings'])
  SETTINGS_CHANNEL_RULES.forEach((rule) => {
    if (!rule.keys.some((key) => keys.includes(key))) return
    rule.channels.forEach((channel) => channels.add(channel))
  })
  return normalizeRefreshChannels(Array.from(channels))
}
