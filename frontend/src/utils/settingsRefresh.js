import { normalizeRefreshChannels } from './appRefresh.js'

export const CATEGORY_REFRESH_CHANNELS = normalizeRefreshChannels(['categories', 'products', 'inventory'])
export const UNIT_REFRESH_CHANNELS = normalizeRefreshChannels(['units', 'products', 'inventory'])

const SETTINGS_CHANNEL_RULES = [
  {
    keys: ['product_brand_options', 'product_brand_color_map'],
    channels: ['settings', 'products', 'inventory', 'pos'],
  },
  {
    keys: ['receipt_template', 'receipt_print_settings'],
    channels: ['settings', 'sales', 'pos', 'dashboard'],
  },
  {
    keys: ['pos_payment_methods'],
    channels: ['settings', 'sales', 'pos', 'dashboard'],
  },
  {
    keys: [
      'business_name',
      'business_phone',
      'business_email',
      'business_address',
      'tax_id',
      'customer_portal_logo_image',
      'ui_app_favicon_image',
      'currency_usd_symbol',
      'currency_khr_symbol',
      'display_currency',
      'exchange_rate',
    ],
    channels: ['settings', 'sales', 'pos', 'dashboard', 'catalog'],
  },
  {
    keys: [
      'notifications_inventory_enabled',
      'notifications_expiry_enabled',
      'notifications_sales_enabled',
      'notifications_loyalty_enabled',
      'notifications_portal_enabled',
      'notifications_system_enabled',
      'notifications_expiry_days',
      'notifications_loyalty_threshold',
      'notifications_realert_minutes',
    ],
    channels: ['settings', 'dashboard', 'users'],
  },
  {
    keys: ['login_session_duration'],
    channels: ['settings', 'users'],
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
