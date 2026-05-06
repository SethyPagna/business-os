import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.jsx', import.meta.url), 'utf8')
const methods = fs.readFileSync(new URL('../src/api/methods.js', import.meta.url), 'utf8')

assert.doesNotMatch(methods, /getDashboard[\s\S]{0,120}\(\)\s*=>\s*\(\{\}\)/, 'dashboard reads should not fall back to an empty object that looks like real data')
assert.doesNotMatch(methods, /getAnalytics[\s\S]{0,200}\(\)\s*=>\s*\(\{\}\)/, 'analytics reads should not fall back to an empty object that looks like real data')

assert.match(dashboard, /function isDashboardSummaryPayload/, 'dashboard should validate summary payloads before rendering them')
assert.match(dashboard, /function isDashboardAnalyticsPayload/, 'dashboard should validate analytics payloads before rendering them')
assert.doesNotMatch(dashboard, /setSummary\(\{\}\)/, 'dashboard should preserve the previous summary when refresh fails')
assert.match(dashboard, /const \[summaryError, setSummaryError\]/, 'dashboard should track summary load errors separately')
assert.match(dashboard, /const \[analyticsError, setAnalyticsError\]/, 'dashboard should track analytics load errors separately')
assert.match(dashboard, /Showing saved dashboard totals/, 'dashboard should explain when it is showing saved/stale totals')
assert.match(dashboard, /Analytics unavailable/, 'dashboard should distinguish analytics failures from genuine no-data states')

console.log('PASS dashboard data reliability guards')
