import assert from 'node:assert/strict'
import fs from 'node:fs'
import { actionAllowed, isActionOverriddenOff } from '../src/utils/permissionActions.ts'
import { getPermissionTierFromMap } from '../src/utils/permissions.ts'
import {
  getReportView,
  reportExportAllowed,
  visibleReportViews,
  type ReportExportPermissions,
  type ReportPermissions,
  type ReportViewId,
} from '../src/components/sales/reports/reportModel.ts'
import { exportMenuItems } from '../src/components/sales/reports/reportTypes.ts'

type PermissionMap = Record<string, unknown>

const allowed = (permissions: PermissionMap, admin: boolean, section: string, action: string): boolean =>
  actionAllowed(
    section,
    action,
    getPermissionTierFromMap(permissions, section, admin),
    (key) => getPermissionTierFromMap(permissions, key, admin) === 'full',
    (candidate, candidateAction) => isActionOverriddenOff(permissions, candidate, candidateAction),
  )

const authority = (permissions: PermissionMap, admin = false): { readable: ReportPermissions; exportable: ReportExportPermissions } => ({
  readable: {
    sales: allowed(permissions, admin, 'sales', 'view'),
    returns: allowed(permissions, admin, 'returns', 'view'),
    fees: allowed(permissions, admin, 'fees', 'view'),
    shift: getPermissionTierFromMap(permissions, 'sales', admin) === 'full' || getPermissionTierFromMap(permissions, 'pos', admin) === 'full',
  },
  exportable: {
    sales: allowed(permissions, admin, 'sales', 'export'),
    returns: allowed(permissions, admin, 'returns', 'export'),
    fees: allowed(permissions, admin, 'fees', 'export'),
  },
})

const cases: Array<{
  name: string
  permissions: PermissionMap
  admin?: boolean
  views: ReportViewId[]
  exports: Partial<Record<ReportViewId, boolean>>
}> = [
  { name: 'none', permissions: {}, views: [], exports: { overview: false, shift: false, sales: false, returns: false, expenses: false } },
  { name: 'Sales view', permissions: { sales: 'view' }, views: ['overview', 'periods', 'sales'], exports: { overview: true, shift: false, sales: true } },
  { name: 'Returns review', permissions: { returns: 'review' }, views: ['overview', 'returns'], exports: { overview: false, returns: false } },
  { name: 'Fees review', permissions: { fees: 'review' }, views: ['overview', 'expenses'], exports: { overview: true, expenses: true } },
  { name: 'Full', permissions: { sales: true, returns: true, fees: true }, views: ['overview', 'shift', 'periods', 'sales', 'returns', 'expenses'], exports: { overview: true, shift: true, sales: true, returns: true, expenses: true } },
  { name: 'Admin', permissions: {}, admin: true, views: ['overview', 'shift', 'periods', 'sales', 'returns', 'expenses'], exports: { overview: true, shift: true, sales: true, returns: true, expenses: true } },
  { name: 'Explicit export false', permissions: { sales: true, returns: true, fees: true, 'sales:export': false, 'returns:export': false, 'fees:export': false }, views: ['overview', 'shift', 'periods', 'sales', 'returns', 'expenses'], exports: { overview: false, shift: false, sales: false, returns: false, expenses: false } },
  { name: 'Explicit Sales view false', permissions: { sales: true, returns: true, 'sales:view': false }, views: ['overview', 'shift', 'returns'], exports: { overview: true, shift: true, sales: false, returns: true } },
]

for (const entry of cases) {
  const result = authority(entry.permissions, entry.admin)
  const ids = visibleReportViews(result.readable).map((view) => view.id)
  for (const expected of entry.views) assert.ok(ids.includes(expected), `${entry.name}: missing ${expected}`)
  if (!entry.views.length) assert.deepEqual(ids, [], `${entry.name}: no view should be visible`)
  for (const [id, expected] of Object.entries(entry.exports)) {
    assert.equal(reportExportAllowed(getReportView(id as ReportViewId), result.readable, result.exportable), expected, `${entry.name}: ${id} export`)
  }
}

const mixed = authority({ sales: true, fees: true, 'fees:export': false })
assert.equal(reportExportAllowed(getReportView('overview'), mixed.readable, mixed.exportable), false, 'Overview refuses export when one included readable domain is denied')
const salesOnly = authority({ sales: true, fees: true, 'fees:view': false, 'fees:export': false })
assert.equal(reportExportAllowed(getReportView('overview'), salesOnly.readable, salesOnly.exportable), true, 'Overview ignores a domain excluded by effective view authority')

let liveAuthority = true
let csvCalls = 0
let printCalls = 0
const items = exportMenuItems((_, fallback) => fallback, () => liveAuthority, () => { csvCalls += 1 }, () => { printCalls += 1 }, { csv: null, print: null })
liveAuthority = false
items[0].onSelect?.()
items[1].onSelect?.()
assert.deepEqual([csvCalls, printCalls], [0, 0], 'stale export callbacks re-check live denial')
liveAuthority = true
items[0].onSelect?.()
items[1].onSelect?.()
assert.deepEqual([csvCalls, printCalls], [1, 1], 'live-authorized callbacks still execute')

const reportFiles = ['OverviewReport', 'SalesListReport', 'ReturnsReport', 'ExpensesReport', 'PeriodReport', 'GroupedReport', 'ShiftReport']
for (const name of reportFiles) {
  const source = fs.readFileSync(new URL(`../src/components/sales/reports/${name}.tsx`, import.meta.url), 'utf8')
  assert.match(source, /p\.canExport\(\)/, `${name} hides its export menu when denied`)
  assert.match(source, /exportMenuItems\(tr, p\.canExport,/, `${name} callbacks receive the live authority getter`)
}

console.log('PASS report none/view/review/full/admin/explicit-false visibility, export, Overview and live-callback matrix')
