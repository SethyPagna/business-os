import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { beginTrackedRequest, isTrackedRequestCurrent } from '../src/utils/loaders.ts'
import {
  finishDashboardStockAlertRequest,
  invalidateDashboardStockAlertRequest,
} from '../src/components/dashboard/dashboardStockAlertRequests.ts'

const requestRef = { current: 0 }
const inFlightRef = { current: false }

inFlightRef.current = true
const oldPageRequest = beginTrackedRequest(requestRef)
invalidateDashboardStockAlertRequest(requestRef, inFlightRef)
assert.equal(inFlightRef.current, false, 'a summary refresh releases the old page request slot')
assert.equal(isTrackedRequestCurrent(requestRef, oldPageRequest), false, 'the old page response is stale after summary refresh')

inFlightRef.current = true
const newPageRequest = beginTrackedRequest(requestRef)
assert.equal(finishDashboardStockAlertRequest(requestRef, oldPageRequest, inFlightRef), false)
assert.equal(inFlightRef.current, true, 'the stale request finally block cannot clear a newer request')
assert.equal(finishDashboardStockAlertRequest(requestRef, newPageRequest, inFlightRef), true)
assert.equal(inFlightRef.current, false, 'the current request releases its own slot')

const dashboard = readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
assert.match(dashboard, /loadSummary[\s\S]{0,500}invalidateStockAlertPageRequests\(\)[\s\S]{0,160}beginTrackedRequest\(summaryRequestRef\)/,
  'summary/filter refresh invalidates page requests before issuing the new summary')
assert.match(dashboard, /useEffect\(\(\) => \{\s*invalidateStockAlertPageRequests\(\)[\s\S]{0,900}setLowStockRows\(initialLowRows\)/,
  'summary page 1 invalidates old append requests before rows and cursors reset')
assert.match(dashboard, /finishDashboardStockAlertRequest\(requestRef, requestId, inFlightRef\)/,
  'a stale request finally block must not release a newer request slot')

console.log('PASS dashboard stock-alert request generation race')
