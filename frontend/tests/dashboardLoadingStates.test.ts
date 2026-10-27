import assert from 'node:assert/strict'
import fs from 'node:fs'

// Source-shape guards for what the pure scheduler test cannot see: how the page uses it.
const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

assert.ok(!/\buseSync\b|syncChannel/.test(dashboard), 'the Dashboard must not gate on the single syncChannel slot (a resume burst leaves only its last channel there)')
assert.ok(dashboard.includes('subscribeSyncSignals('), 'refreshes come from the raw sync signals')
assert.ok(dashboard.includes('createDashboardRefreshScheduler('), 'refreshes go through the debounced, throttled scheduler')
assert.equal((dashboard.match(/getDashboardStartup\(/g) || []).length, 1, 'one call site reads the startup endpoint: no separate summary/analytics loaders')

// B: the loader clears loading whenever its request is the latest, not only when it was started with markLoading.
const finallyBlock = dashboard.slice(dashboard.indexOf('} finally {', dashboard.indexOf('const loadStartup = useCallback')))
assert.match(finallyBlock.slice(0, 260), /if \(isCurrent\(\)\) \{\s*startupInFlightRef\.current = false\s*setLoading\(false\)/, 'loading is released by the latest request')

// C: summary-backed cards get a skeleton while pending, never "No data"/0.
for (const card of ['<RecentSalesCard', '<ExpiryAlertsCard']) {
  const at = dashboard.indexOf(card)
  assert.ok(dashboard.slice(at, at + 400).includes('pending={summaryPending}'), `${card} receives the pending flag`)
}
assert.ok(dashboard.includes('summaryPending ? <div className="p-3"><CardSkeleton /></div>'), 'low/out stock lists show the skeleton while loading')
assert.ok(dashboard.includes("value: summaryReady && analyticsReady ? kpi.value : '\\u2014'"),'KPI cards show a dash, not computed zeros, without figures')
assert.ok(dashboard.includes('loading={summaryPending || analyticsPending}'), 'KPI strip pulses while pending')

// D: one inline notice with Retry; the whole page is never replaced by an error.
assert.ok(!dashboard.includes('Dashboard summary unavailable'), 'no hide-the-whole-page error')
assert.equal((dashboard.match(/role="alert"/g) || []).length, 1, 'exactly one notice for a failed read')
assert.ok(dashboard.includes('showLoadNotice ? ('), 'the notice shows only after the retries are spent')
assert.ok(/onClick=\{\(\) => \{ void reloadStartup\(\) \}\}/.test(dashboard), 'the notice has a Retry action')
assert.ok(!dashboard.includes('Analytics unavailable for this range'), 'cards do not each repeat the failure')
assert.ok(dashboard.includes('isTransientLoadError(error) ? nextRetryDelayMs(retryCountRef.current) : null'), 'transient failures retry on the 2 s / 6 s schedule')
assert.ok(dashboard.includes('const staleScopeRetry = isStaleReadScopeError(error) && !staleScopeRetriedRef.current'), 'stale_read_scope is retried once, silently')
const packs = ['en', 'km'].map((code) => JSON.parse(fs.readFileSync(new URL(`../src/lang/${code}.json`, import.meta.url), 'utf8')))
for (const key of ['dashboard_load_failed', 'dashboard_stale_notice']) {
  for (const pack of packs) assert.ok(typeof pack[key] === 'string' && pack[key].length > 0, `${key} exists in both packs`)
  assert.notEqual(packs[0][key], packs[1][key], `${key} is translated`)
}

console.log('PASS dashboard loading states')
