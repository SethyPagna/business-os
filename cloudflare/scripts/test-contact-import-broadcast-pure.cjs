#!/usr/bin/env node
// Guards two related regressions fixed together:
//
// 1) lib/importEngine.ts used to only broadcast a sync-channel update for
//    job.type 'products' | 'inventory' | 'sales' -- a contacts import
//    (customers/suppliers/delivery_contacts) never broadcast anything at
//    all, so nothing else open (other tabs, the Dashboard's Recent
//    Imports card) ever learned a contacts import had finished.
// 2) frontend/src/components/dashboard/Dashboard.tsx used to gate its
//    second recent-imports refresh effect on
//    `syncChannel?.channel !== 'dashboard'` -- but 'dashboard' was never
//    a real channel (see durable-objects/broadcastHub.ts's own
//    BroadcastChannel union) and nothing ever broadcasts one, so that
//    effect was dead code.
//
// This is a static source check, not a live D1/queue harness -- fast and
// deterministic, and enough to catch a regression where either of these
// two fixes gets silently reverted or drifts out of sync with the other.

const fs = require('fs')
const path = require('path')

let failed = 0
function check(label, condition) {
  if (condition) {
    console.log(`OK: ${label}`)
  } else {
    console.error(`FAIL: ${label}`)
    failed += 1
  }
}

const importEnginePath = path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts')
const importEngineSrc = fs.readFileSync(importEnginePath, 'utf8')

check(
  'importEngine.ts broadcasts on the customers channel for a customers import',
  /customers:\s*'customers'/.test(importEngineSrc),
)
check(
  'importEngine.ts broadcasts on the suppliers channel for a suppliers import',
  /suppliers:\s*'suppliers'/.test(importEngineSrc),
)
check(
  'importEngine.ts broadcasts on the deliveryContacts channel for a delivery_contacts import',
  /delivery_contacts:\s*'deliveryContacts'/.test(importEngineSrc),
)
check(
  'importEngine.ts still broadcasts products/inventory/sales as before (no regression to the existing three types)',
  /broadcast\(env, job\.type === 'sales' \? 'sales' : job\.type === 'inventory' \? 'inventory' : 'products'/.test(importEngineSrc),
)
check(
  'importEngine.ts actually calls broadcast() for the contacts branch, not just defines the map',
  /CONTACT_IMPORT_CHANNEL\[job\.type\]\)\s*\{\s*\n\s*await broadcast\(env, CONTACT_IMPORT_CHANNEL\[job\.type\]/.test(importEngineSrc),
)

const dashboardPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'dashboard', 'Dashboard.tsx')
const dashboardSrc = fs.readFileSync(dashboardPath, 'utf8')

check(
  "Dashboard.tsx no longer gates its refresh effect on the non-existent 'dashboard' channel",
  // Only fail on a live comparison against 'dashboard', not on the
  // explanatory code comment above it that documents the old bug in
  // prose (that comment itself contains this exact substring).
  !/^(?!\s*\/\/).*channel\s*!==\s*'dashboard'/m.test(
    dashboardSrc.replace(/\/\/.*$/gm, '')
  ),
)
check(
  'Dashboard.tsx listens for the real import-related channels instead',
  /IMPORT_RELATED_SYNC_CHANNELS\s*=\s*new Set\(\[('products'|"products"),/.test(dashboardSrc)
  && /'customers'/.test(dashboardSrc) && /'suppliers'/.test(dashboardSrc) && /'deliveryContacts'/.test(dashboardSrc),
)
check(
  'Dashboard.tsx guards the sync-triggered refresh against a stale response landing after a newer one',
  /IMPORT_RELATED_SYNC_CHANNELS\.has\(syncChannel\.channel\)\) return\s*\n\s*let cancelled = false/.test(dashboardSrc),
)

const broadcastHubPath = path.join(__dirname, '..', 'src', 'durable-objects', 'broadcastHub.ts')
const broadcastHubSrc = fs.readFileSync(broadcastHubPath, 'utf8')
check(
  "broadcastHub.ts's BroadcastChannel union still has no 'dashboard' entry (confirms the old gate really was unreachable, not just currently unused)",
  !/'dashboard'/.test(broadcastHubSrc),
)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
