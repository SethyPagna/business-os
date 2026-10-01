import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { buildInventoryProductsSearchParams } from '../src/components/inventory/inventoryProductsQuery.ts'

test('Inventory sends exact Cambodia endpoint timestamps and changes requests when only hours change', () => {
  const base = { branchFilter: 'all', query: '', searchMode: 'and', page: 1, pageSize: 20 }
  const range = { startDate: '2026-09-05', endDate: '2026-09-06', startTime: '09:00', endTime: '11:00' }
  const query = buildInventoryProductsSearchParams({ ...base, range })
  assert.equal((query as Record<string, unknown>).createdFrom, '2026-09-05 02:00:00')
  assert.equal((query as Record<string, unknown>).createdTo, '2026-09-06 04:01:00')
  assert.notDeepEqual(query, buildInventoryProductsSearchParams({ ...base, range: { ...range, startTime: '10:00' } }))
  assert.throws(() => buildInventoryProductsSearchParams({ ...base, range: { ...range, endDate: range.startDate, startTime: '18:00', endTime: '08:00' } }), RangeError)
})

test('Inventory loaders, cache scopes and stats export retain hours with continuous picker semantics', () => {
  const source = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
  assert.equal((source.match(/continuousRangeParams\(range\)|continuousRangeParams\(stripRange\)/g) || []).length, 2)
  assert.match(source, /productsScope = JSON\.stringify\(\[[^\]]*stripRange\.startTime[^\]]*stripRange\.endTime/)
  assert.match(source, /setProductsPage\(1\)\s*\}, \[[^\]]*stripRange\.endTime[^\]]*stripRange\.startTime/)
  assert.match(source, /<StatsRangeRow[^>]*showTime[^>]*continuous/s)
  assert.match(source, /setStatsExportRange\(\{ \.\.\.stripRange \}\)/)
  assert.match(source, /initial=\{statsExportRange\}[\s\S]{0,300}showTime[\s\S]{0,40}continuous/)
})

test('Branch transfers send recurring hours in list/export and refresh when hours change', () => {
  const source = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
  assert.equal((source.match(/startTime: branchDateRange\.startTime \|\| undefined/g) || []).length, 2)
  assert.equal((source.match(/endTime: branchDateRange\.endTime \|\| undefined/g) || []).length, 2)
  assert.match(source, /<StatsRangeRow[\s\S]{0,100}showTime=\{tab === 'transfers'\}/)
  assert.equal((source.match(/branchDateRange\.endTime, branchDateRange\.startTime/g) || []).length, 2)
})
