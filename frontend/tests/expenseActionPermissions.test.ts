import assert from 'node:assert/strict'
import fs from 'node:fs'
import { actionAllowed, isActionOverriddenOff } from '../src/utils/permissionActions.ts'
import { getPermissionTierFromMap } from '../src/utils/permissions.ts'

type PermissionMap = Record<string, unknown>

const can = (permissions: PermissionMap, admin: boolean, action: string): boolean => actionAllowed(
  'fees',
  action,
  getPermissionTierFromMap(permissions, 'fees', admin),
  (key) => getPermissionTierFromMap(permissions, key, admin) === 'full',
  (section, candidate) => isActionOverriddenOff(permissions, section, candidate),
)

const matrix: Array<{ name: string; permissions: PermissionMap; admin?: boolean; expected: Record<string, boolean> }> = [
  { name: 'none', permissions: {}, expected: { view: false, add: false, edit: false, delete: false, export: false } },
  { name: 'review', permissions: { fees: 'review' }, expected: { view: true, add: true, edit: true, delete: true, export: true } },
  { name: 'full', permissions: { fees: true }, expected: { view: true, add: true, edit: true, delete: true, export: true } },
  { name: 'admin', permissions: {}, admin: true, expected: { view: true, add: true, edit: true, delete: true, export: true } },
  { name: 'explicit false', permissions: { fees: true, 'fees:edit': false, 'fees:delete': false, 'fees:export': false }, expected: { view: true, add: true, edit: false, delete: false, export: false } },
]

for (const entry of matrix) {
  for (const [action, expected] of Object.entries(entry.expected)) {
    assert.equal(can(entry.permissions, !!entry.admin, action), expected, `${entry.name}: fees:${action}`)
  }
}

const page = fs.readFileSync(new URL('../src/components/fees/FeesPage.tsx', import.meta.url), 'utf8')
const modal = fs.readFileSync(new URL('../src/components/fees/ExpenseLabelManagerModal.tsx', import.meta.url), 'utf8')

for (const action of ['edit', 'delete', 'export']) assert.match(page, new RegExp(`can\\('fees', '${action}'\\)`), `FeesPage derives fees:${action}`)
assert.match(page, /performExpenseDelete[\s\S]*if \(!operation\.canDelete\(\)\) return false[\s\S]*operation\.confirmDelete\(\)[\s\S]*if \(!operation\.canDelete\(\)\) return false/, 'delete checks live authority before and after confirmation')
assert.match(page, /canDelete: \(\) => canDeleteFeeRef\.current/, 'the detail delete callback reads current authority at action time')
assert.equal((page.match(/\{canDeleteFee \? \(/g) || []).length, 1, 'Delete is exposed only inside detail and hidden when denied')
const list = page.slice(page.indexOf('<div className="dense-data-shell'), page.indexOf("{modal === 'detail'"))
assert.doesNotMatch(list, /<Pencil|<Trash2|tr\('actions'/, 'desktop and compact lists contain no mutation controls')
const detail = page.slice(page.indexOf("{modal === 'detail'"), page.indexOf("{modal === 'form'"))
assert.equal((detail.match(/\{canEditFee \? \(/g) || []).length, 1, 'Edit is exposed only inside detail and hidden when denied')
assert.match(page, /data-clickable="true" tabIndex=\{0\}[\s\S]*openDetail\(fee\)/, 'read-only viewers can open desktop detail without edit authority')
assert.match(page, /data-expense-card="" onClick=\{\(\) => openDetail\(fee\)\}/, 'read-only viewers can open compact detail without edit authority')
assert.match(page, /const openEdit = \(fee:[^]*?canEditFeeRef\.current/, 'detail Edit rechecks live authority')
assert.match(page, /if \(!canExportFeeRef\.current \|\| exportInFlightRef\.current\) return[\s\S]*await getAllFeesForExport[\s\S]*if \(!canExportFeeRef\.current\) return/, 'async export refuses to open a result after revocation')
assert.match(page, /exportDialog && canExportFee/, 'an already-open expense export closes synchronously on denial')
assert.match(page, /showLabelManager && canEditFee/, 'label manager is removed synchronously on edit denial')
assert.match(page, /if \(!canEditFee\) setShowLabelManager\(false\)/, 'mounted label manager state is closed after revocation')
assert.match(page, /canEdit=\{\(\) => canEditFeeRef\.current\}/, 'label callbacks receive live authority')
assert.ok((modal.match(/if \(!canEdit\(\)\) return/g) || []).length >= 6, 'rename/classify re-check live authority before prompts, writes and results')
assert.match(modal, /getFeeLabelImpact[\s\S]*if \(!canEdit\(\)\) return[\s\S]*replaceFeeLabel/, 'rename preview cannot flow into a denied write')
assert.match(modal, /getFeeLabelTypeImpact[\s\S]*if \(!canEdit\(\)\) return[\s\S]*classifyFeeLabel/, 'classify preview cannot flow into a denied write')

console.log('PASS Expense none/review/full/admin/explicit-false and live callback authority matrix')
