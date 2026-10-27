import assert from 'node:assert/strict'
import fs from 'node:fs'

import { getSettingsRefreshChannels } from '../src/utils/settingsRefresh.ts'
import { DASHBOARD_REFRESH_CHANNELS } from '../src/components/dashboard/dashboardRefresh.ts'

const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
const pos = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')

const channels = getSettingsRefreshChannels({
  low_stock_alert_enabled: 'true',
  low_stock_threshold_mode: 'global',
  low_stock_threshold_default: '4',
})

assert.ok(channels.includes('settings'), 'low-stock saves must broadcast the settings channel')
assert.ok(channels.includes('dashboard'), 'low-stock saves must broadcast the dashboard channel')
assert.ok(channels.includes('pos'), 'low-stock saves must broadcast the POS channel')

// The Dashboard re-reads its server-classified alert counts and rows (one startup read) when a settings or dashboard
// change arrives: both channels are in the refresh set it subscribes with.
assert.ok(DASHBOARD_REFRESH_CHANNELS.has('settings') && DASHBOARD_REFRESH_CHANNELS.has('dashboard'), 'Dashboard must refetch its server-classified alert counts and rows when settings change')
assert.ok(dashboard.includes('subscribeSyncSignals(DASHBOARD_REFRESH_CHANNELS,'), 'the Dashboard subscribes with that set')
assert.match(
  pos,
  /channel === 'categories' \|\| channel === 'settings'[\s\S]{0,520}loadCatalogData\('POS sync catalog', \{ forceMetadata: channel === 'branches' \|\| channel === 'settings' \}\)/,
  'POS must refetch its filtered catalogue and metadata when settings change',
)

console.log('PASS low-stock settings refresh contract')
