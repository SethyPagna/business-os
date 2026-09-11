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

console.log('saleDetailAmendmentLoadingLayout: loading is accessible and layout-neutral; errors and history remain visible PASS')
