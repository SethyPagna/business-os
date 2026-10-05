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
// G39 item 7 (5e35a39c3) then changed HOW the Dashboard's second effect hears
// about a finished import, without bringing the dead gate back: it no longer
// re-reads import jobs on every products/inventory/sales/customers/... event
// (that cost one read per sale at a till). It now listens for the Worker's
// { action: 'import' } push (the broadcast guarded in 1) -- through the same
// subscription as the first effect -- and, as a catch-up for a push missed
// during a socket gap, for the CLIENT-dispatched 'dashboard' resume event
// whose reason is FOREGROUND_RESUME_GAP_REASON. That gate is live, not dead:
// syncRuntime.ts dispatches 'dashboard' on every resume and web-api.ts tags it
// with that reason. The checks below pin all of this.
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

const stripLineComments = (src) => src.replace(/\/\/.*$/gm, '')
const dashboardCode = stripLineComments(dashboardSrc)
const syncRuntimeSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'api', 'syncRuntime.ts'), 'utf8')
const webApiSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'web-api.ts'), 'utf8')
const importJobRefreshSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'importJobRefresh.ts'), 'utf8')

// The gate on the 'dashboard' channel must be one that something really sends.
// Bare `channel !== 'dashboard'` (the old dead gate) is only acceptable when it
// is paired with the resume-gap reason, and that pair must be dispatched.
const dashboardGate = dashboardCode.match(/syncChannel\?\.channel !== 'dashboard' \|\| syncChannel\.reason !== FOREGROUND_RESUME_GAP_REASON\) return\s*\n\s*let cancelled = false/)
const resumeChannels = (syncRuntimeSrc.match(/FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS = \[([\s\S]*?)\] as const/) || [])[1] || ''
check(
  "Dashboard.tsx gates its resume catch-up refresh on 'dashboard' only together with the resume-gap reason",
  !!dashboardGate
  && (dashboardCode.match(/channel\s*!==\s*'dashboard'/g) || []).length === 1,
)
check(
  "that 'dashboard' + resume-gap gate is reachable: the resume dispatch includes 'dashboard' and web-api tags it with the gap reason",
  /'dashboard'/.test(resumeChannels)
  && /dispatchSyncUpdates\(\s*FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS,\s*socketStayedOpen \? FOREGROUND_RESUME_REASON : FOREGROUND_RESUME_GAP_REASON/.test(webApiSrc),
)
check(
  "Dashboard.tsx hears a finished import through the Worker's { action: 'import' } push, for every import type",
  /const stopPush = onImportJobPush\(onActivity\)/.test(dashboardCode)
  && /payload\.action === 'import'/.test(importJobRefreshSrc),
)
check(
  'Dashboard.tsx no longer re-reads import jobs on every products/inventory/sales/contacts sync event (one read per sale at a till)',
  !/IMPORT_RELATED_SYNC_CHANNELS/.test(dashboardCode)
  // Exactly two readers remain: the mount/push/activity effect and the
  // resume-gap catch-up. A third, gated on any other channel, would be the
  // old per-sale read coming back under a different name.
  && (dashboardCode.match(/listImportJobs\(/g) || []).length === 2,
)
check(
  'Dashboard.tsx guards the sync-triggered refresh against a stale response landing after a newer one',
  !!dashboardGate
  && /syncChannel\.reason !== FOREGROUND_RESUME_GAP_REASON\) return\s*\n\s*let cancelled = false\s*\n\s*listImportJobs\([^)]*\)\s*\n\s*\.then\(\(result\) => \{\s*\n\s*if \(cancelled\) return/.test(dashboardCode)
  && /return \(\) => \{ cancelled = true \}/.test(dashboardCode),
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
