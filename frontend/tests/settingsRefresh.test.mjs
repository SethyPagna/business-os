import assert from 'node:assert/strict'

import {
  CATEGORY_REFRESH_CHANNELS,
  getSettingsRefreshChannels,
  UNIT_REFRESH_CHANNELS,
} from '../src/utils/settingsRefresh.js'

assert.deepEqual(
  getSettingsRefreshChannels({
    product_brand_options: '[]',
    product_brand_color_map: '{}',
  }),
  ['settings', 'products', 'inventory', 'pos'],
)

assert.deepEqual(
  getSettingsRefreshChannels({
    receipt_template: '{"show_logo":true}',
  }),
  ['settings', 'sales', 'pos', 'dashboard'],
)

assert.deepEqual(
  getSettingsRefreshChannels({
    receipt_print_settings: '{"paperSize":"58mm"}',
  }),
  ['settings', 'sales', 'pos', 'dashboard'],
)

assert.deepEqual(
  getSettingsRefreshChannels({
    pos_payment_methods: '["Cash"]',
  }),
  ['settings', 'sales', 'pos', 'dashboard'],
)

assert.deepEqual(
  getSettingsRefreshChannels({
    business_name: 'Leang Cosmetics',
  }),
  ['settings', 'sales', 'pos', 'dashboard', 'catalog'],
)

assert.deepEqual(
  getSettingsRefreshChannels({
    notifications_inventory_enabled: 'true',
  }),
  ['settings', 'dashboard', 'users'],
)

assert.deepEqual(
  getSettingsRefreshChannels({
    login_session_duration: '30d',
  }),
  ['settings', 'users'],
)

assert.deepEqual(
  getSettingsRefreshChannels({ some_other_setting: 'x' }),
  ['settings'],
)

assert.deepEqual(
  getSettingsRefreshChannels({ receipt_template: 'x' }, ['settings', 'sales', 'settings']),
  ['settings', 'sales'],
)

assert.deepEqual(CATEGORY_REFRESH_CHANNELS, ['categories', 'products', 'inventory'])
assert.deepEqual(UNIT_REFRESH_CHANNELS, ['units', 'products', 'inventory'])

console.log('PASS settings refresh routing')
