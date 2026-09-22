import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { loadRecordsFloatModule } from './recordsFloatModule.ts'
import type { SaleRecord, SaleRecordValue } from '../src/utils/saleRecords.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const source = readFileSync(new URL('../src/components/sales/SaleRecordsFloat.tsx', import.meta.url), 'utf8')
const mod = { exports: {} as Record<string, unknown> }
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', compiled)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  // The REAL shared float: the change table under test lives there now.
  if (id.includes('shared/RecordsFloat')) return loadRecordsFloatModule()
  if (id.includes('utils/saleRecords')) return require('../src/utils/saleRecords.ts')
  if (id.includes('saleRecordValue')) return require('../src/components/sales/saleRecordValue.ts')
  if (id.includes('StatusBadge')) return { getStatusLabel: String }
  if (id.includes('utils/formatters')) return { fmtDateTime24: () => '' }
  if (id.includes('salesTransport')) return { getSaleRecords: async () => ({ records: [] }) }
  if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
  return { __esModule: true, default: ({ children }: { children?: unknown }) => React.createElement(React.Fragment, null, children) }
}, mod, mod.exports)

const Table = mod.exports.SaleRecordChangeTable as React.ComponentType<Record<string, unknown>>
const known = (value: unknown): SaleRecordValue => ({ state: 'known_value', value })
const none: SaleRecordValue = { state: 'known_none' }
const render = (record: SaleRecord): string => renderToStaticMarkup(React.createElement(Table, {
  record,
  t: (key: string) => ({ money_calculated_total: 'Calculated total', money_rounding_adjustment: 'Rounding adjustment', none: 'None' }[key] || key),
  fmtUSD: (amount: number | string) => `$${Number(amount).toFixed(2)}`,
  fmtKHR: String,
}))

const v1 = render({ id: 'v1', kind: 'sale_created', changes: [
  { field: 'calculated_total_usd', before: none, after: known(1.2345) },
  { field: 'rounding_adjustment_usd', before: known(-0.0045), after: known(0.0055) },
] })
assert.match(v1, /Calculated total/)
assert.match(v1, /\$1\.2345/)
assert.match(v1, /Rounding adjustment/)
assert.match(v1, /-\$0\.0045/)
assert.match(v1, /\$0\.0055/)
assert.doesNotMatch(v1, /\$1\.23(?:<|&)/)

const legacy = render({ id: 'legacy', kind: 'legacy_sale_change', changes: [] })
assert.doesNotMatch(legacy, /Calculated total|Rounding adjustment|\$0\.0000/)
const nullOnly = render({ id: 'legacy-null', changes: [
  { field: 'calculated_total_usd', before: none, after: none },
  { field: 'rounding_adjustment_usd', before: none, after: none },
] })
assert.doesNotMatch(nullOnly, /Calculated total|Rounding adjustment|\$0\.0000/)

console.log('sale records precision render: all cases pass')
