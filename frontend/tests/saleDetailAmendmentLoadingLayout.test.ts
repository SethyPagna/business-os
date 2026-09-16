import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const historyStart = source.indexOf('{/* THE AUDIT TRAIL')
const historyEnd = source.indexOf("{currentStatus === 'cancelled'", historyStart)

assert.ok(historyStart >= 0 && historyEnd > historyStart, 'the sale amendment history region remains present')
const history = source.slice(historyStart, historyEnd)

assert.match(
  history,
  /\{amendmentsLoading \? \(\s*<div className="sr-only" role="status" aria-live="polite" aria-atomic="true">/,
  'initial history loading remains announced without occupying layout space',
)
assert.match(
  history,
  /\{amendmentsFailed \|\| amendmentGroups\.length > 0 \? \(\s*<SectionCard title=/,
  'only an error or real history may insert the in-flow history card above status and actions',
)
assert.doesNotMatch(
  history,
  /amendmentsLoading \|\| amendmentsFailed \|\| amendmentGroups\.length > 0/,
  'a delayed empty history read must not add and then remove an in-flow card',
)
assert.doesNotMatch(
  history,
  /<SectionCard[\s\S]*?\{amendmentsLoading \?/,
  'the loading state must stay outside the visible history card',
)
assert.match(
  history,
  /\{amendmentsFailed \? \([\s\S]*?amendment_history_failed[\s\S]*?<ol className="space-y-2">[\s\S]*?amendmentGroups\.map/,
  'load failures keep their retry guidance and successful non-empty history keeps its rows',
)

const addItemsStart = source.indexOf('{canOfferAddItems ? (')
const addItemsEnd = source.indexOf('{/* THE AUDIT TRAIL', addItemsStart)
assert.ok(addItemsStart >= 0 && addItemsEnd > addItemsStart, 'the add-items region remains present')
const addItems = source.slice(addItemsStart, addItemsEnd)
const trackedLoadingStart = addItems.indexOf("trackedBatchLookupState === 'loading'")
const trackedLoadingEnd = addItems.indexOf(") : trackedBatchLookupState === 'failed'", trackedLoadingStart)
assert.ok(trackedLoadingStart >= 0 && trackedLoadingEnd > trackedLoadingStart, 'the tracked-date pending branch remains present')
const trackedLoading = addItems.slice(trackedLoadingStart, trackedLoadingEnd)

assert.match(
  trackedLoading,
  /trackedBatchLookupState === 'loading'[\s\S]*?<p role="status" aria-live="polite" aria-atomic="true" className="sr-only">[\s\S]*?Checking received dates/,
  'the received-date lookup remains announced without shifting the controls below it',
)
assert.doesNotMatch(
  trackedLoading,
  /<p[^>]*className="[^"]*(?:mt-|text-\[11px\])[^"]*"/,
  'the pending tracked-date lookup must not insert a visible line into the add-items section',
)
assert.match(
  addItems,
  /trackedBatchLookupState === 'failed'[\s\S]*?<div role="alert"[\s\S]*?received_dates_load_failed[\s\S]*?setTrackedBatchReloadKey/,
  'a failed lookup remains a visible safety error with its Retry action',
)

console.log('saleDetailAmendmentLoadingLayout: both loaders are accessible and layout-neutral; errors and history remain visible PASS')
