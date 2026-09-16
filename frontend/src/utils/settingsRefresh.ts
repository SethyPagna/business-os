import { normalizeRefreshChannels } from './appRefresh.ts'

export const CATEGORY_REFRESH_CHANNELS = normalizeRefreshChannels(['categories', 'products', 'inventory'])
export const UNIT_REFRESH_CHANNELS = normalizeRefreshChannels(['units', 'products', 'inventory'])

type SettingsUpdates = Record<string, unknown>

type SettingsChannelRule = {
  keys: string[]
  channels: string[]
}

const SETTINGS_CHANNEL_RULES: SettingsChannelRule[] = [
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
    // Without a 'pos' channel here, turning the wholesale automation on would
    // not reach an already-open till until it was reloaded -- the cashier
    // would tick the box and watch nothing happen.
    keys: ['pos_wholesale_auto_enabled', 'pos_wholesale_auto_min_qty'],
    channels: ['settings', 'pos'],
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
    // The low-stock switch/amount/scope re-colour a badge, a count and a
    // filter on five open pages at once -- the till included, same reasoning
    // as the wholesale rule above. Without these channels an owner would turn
    // the alert off in Settings and watch the Dashboard card, the Products
    // list and the POS grid keep showing amber until each was reloaded.
    keys: ['low_stock_alert_enabled', 'low_stock_threshold_mode', 'low_stock_threshold_default'],
    channels: ['settings', 'products', 'inventory', 'branches', 'pos', 'dashboard', 'notifications'],
  },
  {
    keys: ['login_session_duration'],
    channels: ['settings', 'users'],
  },
]

function normalizeSettingKeys(updates: SettingsUpdates = {}): string[] {
  return [...new Set(
    Object.keys(updates || {})
      .map((key) => String(key || '').trim())
      .filter(Boolean),
  )]
}

export function getSettingsRefreshChannels(updates: SettingsUpdates = {}, explicitChannels: unknown[] = []): string[] {
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
