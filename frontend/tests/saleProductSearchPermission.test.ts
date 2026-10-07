import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { effectivePermissions } from '../src/utils/permissions.ts'
import {
  mergeSaleProductSearchCandidates,
  normalizeSaleProductSearchPage,
  SALE_DETAIL_PRODUCT_PAGE_SIZE,
} from '../src/components/sales/saleProductSearch.ts'

const source = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const gate = source.match(/  const (canLoad(?:AddItems|SaleProducts)) = (.+)/)!
assert.ok(gate, 'shared catalogue gate must exist')
const gateName = gate[1]
const searchStart = source.indexOf('  const loadAddProductSearchPage = ')
const searchEnd = source.indexOf('\n  useEffect(', searchStart)
const searchCode = stripTypeScriptTypes(source.slice(searchStart, searchEnd))
const trackingStart = source.indexOf('  useEffect(', source.indexOf(gate[0]))
const trackingEnd = source.indexOf('\n\n  const loadAddProductSearchPage', trackingStart)
const trackingCode = stripTypeScriptTypes(source.slice(trackingStart, trackingEnd))
const effectStart = searchEnd
const effectEnd = source.indexOf('\n  const ', source.indexOf('}, [addQuery,', effectStart))
const effectCode = stripTypeScriptTypes(source.slice(effectStart, effectEnd))

for (const [name, addAllowed, amendAllowed] of [
  ['owner', true, true],
  ['employee add only', true, false],
  ['employee amend only', false, true],
  ['employee neither', false, false],
] as const) {
  const actor = name === 'owner' ? { role_code: 'admin' } : {
    role_code: 'employee', role_permissions: { sales: true, 'sales:add_items': addAllowed, 'sales:amend': amendAllowed, products: false },
  }
  const { can } = effectivePermissions(actor)
  const onAddItems = can('sales', 'add_items') ? () => true : undefined
  const onAmend = can('sales', 'amend') ? () => true : undefined
  const allowed = new Function('onAddItems', 'onAmend', `return ${gate[2]}`)(onAddItems, onAmend)
  assert.equal(allowed, addAllowed || amendAllowed, `${name}: shared reads follow either permitted writer`)
  assert.equal(Boolean(onAddItems), addAllowed, `${name}: catalogue access cannot grant Add Items`)
  assert.equal(Boolean(onAmend), amendAllowed, `${name}: catalogue access cannot grant Amend`)

  const reads: Record<string, unknown>[] = []
  let candidates: { id: number }[] = []
  let trackingReads = 0
  let scheduledSearches = 0
  const env: Record<string, unknown> = {
    [gateName]: allowed, detailScope: 'disposable-actor:sale1', detailScopeRef: { current: 'disposable-actor:sale1' },
    detailAliveRef: { current: true }, addSearchSeqRef: { current: 0 }, sale: { branch_id: 2 }, stockBranchId: 2, addQuery: 'powder',
    trackedBatchReloadKey: 0, SALE_DETAIL_PRODUCT_PAGE_SIZE,
    searchProducts: async (params: Record<string, unknown>) => { reads.push(params); return { items: [{ id: 7 }], page: params.page, pageSize: 8, total: 9, totalPages: 2 } },
    normalizeSaleProductSearchPage, mergeSaleProductSearchCandidates,
    setAddCandidates: (value: unknown) => { candidates = typeof value === 'function' ? value(candidates) : value as typeof candidates },
    setAddLoadingMore: () => {}, setAddSearching: () => {}, setAddSearchError: () => {}, setAddSearchPage: () => {}, setAddSearchFailedPage: () => {},
    getTrackedBatchProductIds: async () => { trackingReads++; return { productIds: [7] } },
    setTrackedBatchLookupState: () => {}, setTrackedBatchLookupError: () => {}, setTrackedBatchProductIds: () => {},
    useEffect: (effect: () => unknown) => effect(),
    window: { setTimeout: () => { scheduledSearches++; return 1 }, clearTimeout: () => {} },
  }
  new Function('env', `with(env) { ${trackingCode} }`)(env)
  assert.equal(trackingReads, allowed ? 1 : 0, `${name}: replacements verify tracked batches too`)
  const load = new Function('env', `with(env) { ${searchCode}; return loadAddProductSearchPage }`)(env)
  await load('powder', 1, false)
  await load('powder', 2, true)
  assert.equal(reads.length, allowed ? 2 : 0, `${name}: actual callback loads first and later pages`)
  if (allowed) {
    assert.equal(reads[0].surface, 'pos', 'sales operations keep the existing redacted POS catalogue contract')
    assert.equal(reads[0].branchId, 2, 'search stays in the sale branch')
    assert.deepEqual(candidates, [{ id: 7 }], 'later pages do not duplicate expanded siblings')
  }
  await load('p', 1, false)
  assert.equal(reads.length, allowed ? 2 : 0, 'short queries do not send requests')
  env.loadAddProductSearchPage = load
  new Function('env', `with(env) { ${effectCode}\n }`)(env)
  assert.equal(scheduledSearches, allowed ? 1 : 0, `${name}: typing reaches the actual debounce effect`)
}

console.log('PASS sale product search owner/employee Add/Amend permission matrix')
