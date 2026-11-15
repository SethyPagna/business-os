// lane/sales-stats-reads R2-1: the exact-sale link on a COLD mount of Sales.
// Both the consume effect (Sales.tsx) and the focus-settling effect run in one passive-effect flush on the first mount; the settling effect carries the first
// render's (empty) search and dates. It must not drop a focus it never saw. This mounts the REAL React runtime with the REAL salesFocus.ts and
// useDebouncedValue.ts, mirroring Sales.tsx's hook order, and records the params the list + /stats fetch effect would send.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { activeSalesFocusId, parseSalesFocus, useSettleSalesFocus, type SalesFocus } from '../src/components/sales/salesFocus.ts'
import { useDebouncedValue } from '../src/utils/useDebouncedValue.ts'

const g = globalThis as any
g.IS_REACT_ACT_ENVIRONMENT = false
const listeners = new Map<string, Set<(e: any) => void>>()
g.window = g
g.addEventListener = (t: string, f: any) => { (listeners.get(t) || listeners.set(t, new Set()).get(t)!).add(f) }
g.removeEventListener = (t: string, f: any) => { listeners.get(t)?.delete(f) }
const store = new Map<string, string>()
const storage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
}
Object.defineProperty(g, 'sessionStorage', { value: storage, configurable: true, writable: true })
const doc: any = { nodeType: 9, addEventListener() {}, removeEventListener() {}, activeElement: null, defaultView: g }
g.document = doc
g.HTMLIFrameElement = class {}
const container: any = {
  nodeType: 1, tagName: 'DIV', nodeName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: doc,
  addEventListener() {}, removeEventListener() {}, removeChild() {}, appendChild() {}, firstChild: null, lastChild: null,
}

const EMPTY = { startDate: '', endDate: '', startTime: '', endTime: '' }
const requests: string[] = []
let setSearchOut: (v: string) => void = () => {}
let setRangeOut: (v: typeof EMPTY) => void = () => {}

function Page({ isActive }: { isActive: boolean }) {
  const [search, setSearch] = useState('')
  const [stripRange, setStripRange] = useState(() => ({ startDate: '2026-11-14', endDate: '2026-11-14', startTime: '', endTime: '' }))
  const [salesFocus, setSalesFocus] = useState<SalesFocus | null>(null)
  setSearchOut = setSearch
  setRangeOut = setStripRange
  useEffect(() => { // the consume effect, as in Sales.tsx
    if (!isActive) return
    const consume = () => {
      const raw = storage.getItem('bos:sales:focus')
      if (!raw) return
      const payload = JSON.parse(raw)
      const s = String(payload?.search || '').trim()
      if (s) { setSearch(s); setStripRange({ ...EMPTY }); setSalesFocus(parseSalesFocus(payload)) }
      storage.removeItem('bos:sales:focus')
    }
    consume()
    g.addEventListener('bos:entity-focus', consume)
    return () => g.removeEventListener('bos:entity-focus', consume)
  }, [isActive])
  const debounced = useDebouncedValue(search, 60)
  const lastRef = useRef('')
  const effective = useMemo(() => {
    if (debounced.trim().length > 0 && debounced.trim().length < 2) return lastRef.current
    lastRef.current = debounced
    return debounced
  }, [debounced])
  const range = useMemo(() => {
    const o: { startDate?: string; endDate?: string } = {}
    if (stripRange.startDate) o.startDate = stripRange.startDate
    if (stripRange.endDate) o.endDate = stripRange.endDate
    return o
  }, [stripRange.startDate, stripRange.endDate])
  const focusId = activeSalesFocusId(salesFocus, search, effective, range)
  useSettleSalesFocus(salesFocus, setSalesFocus, search, effective, range)
  const params = JSON.stringify({ ...(focusId ? { id: focusId } : effective ? { search: effective } : {}), ...range })
  useEffect(() => { requests.push(params) }, [params])
  return null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const queueLink = () => storage.setItem('bos:sales:focus', JSON.stringify({ saleId: 42, search: 'R0000123' }))
const take = () => requests.splice(0)
const readsAllTime = (list: string[]) => list.filter((p) => p === '{}' || (p.includes('"search"') && !p.includes('"startDate"')))
const ID = '{"id":42}'

// --- cold mount: the first mount is already active and the link is queued
{
  queueLink()
  const root = createRoot(container)
  root.render(React.createElement(Page, { isActive: true }))
  await wait(400)
  const seen = take()
  assert.equal(seen[seen.length - 1], ID, `cold mount settles on the exact sale (saw ${seen.join(' | ')})`)
  assert.deepEqual(readsAllTime(seen), [], `cold mount fires no all-time read, unfiltered or text (saw ${seen.join(' | ')})`)
  setSearchOut('R00001'); await wait(300)
  assert.deepEqual(take(), ['{"search":"R00001"}'], 'cold: editing the box reads as typed')
  setSearchOut('R0000123'); await wait(300)
  assert.deepEqual(take(), ['{"search":"R0000123"}'], 'cold: retyping the receipt is a fresh search, never the id again')
  root.unmount()
}

// --- warm mount: Sales mounted first (inactive), then the link activates it
{
  requests.length = 0
  const root = createRoot(container)
  root.render(React.createElement(Page, { isActive: false }))
  await wait(200)
  take()
  queueLink()
  root.render(React.createElement(Page, { isActive: true }))
  await wait(400)
  const seen = take()
  assert.equal(seen[seen.length - 1], ID, `warm mount settles on the exact sale (saw ${seen.join(' | ')})`)
  assert.deepEqual(readsAllTime(seen), [], `warm mount fires no all-time read (saw ${seen.join(' | ')})`)
  setSearchOut('R000012'); await wait(10); setSearchOut('R0000123'); await wait(300)
  assert.deepEqual(take(), [], 'warm: an edit that is retyped inside the lag sends nothing')
  setSearchOut('R00001'); await wait(300)
  assert.deepEqual(take(), ['{"search":"R00001"}'], 'warm: editing past the lag reads as typed')
  setSearchOut('R0000123'); await wait(300)
  assert.deepEqual(take(), ['{"search":"R0000123"}'], 'warm: retyping is a fresh search')
  root.unmount()
}

// --- picking dates ends the focus for good
{
  requests.length = 0
  queueLink()
  const root = createRoot(container)
  root.render(React.createElement(Page, { isActive: true }))
  await wait(300)
  take()
  setRangeOut({ startDate: '2026-11-01', endDate: '2026-11-14', startTime: '', endTime: '' }); await wait(300)
  assert.deepEqual(take(), ['{"search":"R0000123","startDate":"2026-11-01","endDate":"2026-11-14"}'], 'picking dates ends the focus')
  setRangeOut({ ...EMPTY }); await wait(300)
  assert.deepEqual(take(), ['{"search":"R0000123"}'], 'clearing the dates does not bring the focus back')
  root.unmount()
}

// --- the page declares the settle hook after the consume effect, through the shared hook (the order the probe depends on)
const here = resolve(fileURLToPath(new URL('..', import.meta.url)))
const src = readFileSync(resolve(here, 'src/components/sales/Sales.tsx'), 'utf8').replace(/\r\n?/g, '\n')
const consumeAt = src.indexOf('const consumeFocus = () =>')
const settleAt = src.indexOf('useSettleSalesFocus(salesFocus, setSalesFocus, search, effectiveSalesSearch, salesDateRange)')
assert.ok(consumeAt > 0 && settleAt > consumeAt, 'Sales.tsx runs the settle hook after the consume effect, through the shared hook')
assert.ok(!/setSalesFocus\(\(current\) => nextSalesFocus/.test(src), 'Sales.tsx no longer settles the focus with an unguarded updater')

console.log('PASS sales focus mount: cold, warm, edit, retype, dates')
process.exit(0)
