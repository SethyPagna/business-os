// Canonical branches are fixed identities. The former selection toolbar was
// useful only for bulk deletion, so keeping its select-all affordance after
// deletion became impossible would advertise a dead action.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { branchRoleFromName } from '../src/utils/branchRoles.ts'

const branches = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const form = fs.readFileSync(new URL('../src/components/branches/BranchForm.tsx', import.meta.url), 'utf8')

assert.doesNotMatch(branches, /branches-select-all|selectedIds|handleBulkDelete|bulkDeleteBusy/,
  'fixed branch identities must not expose the obsolete bulk-delete selection mode')
assert.doesNotMatch(branches, /branchApi\.(createBranch|deleteBranch)\(|tr\('add_branch'|title=\{tr\('delete'/,
  'the branch page must not advertise create/delete actions rejected by the server')
assert.match(branches, /const canEditBranch = can\('branches', 'edit'\)/,
  'metadata editing must retain the current branches edit permission')
assert.match(branches, /canEditBranch && canEditBranchRecord\(branch\)/,
  'metadata editing must require permission and a recognized active or retired canonical row')
assert.match(branches, /if \(!isEdit \|\| !canEditBranch\) \{[\s\S]*?reparkDeniedRestore\(entry\)/,
  'draft restoration must recheck the current edit permission')
assert.match(branches, /if \(!canEditBranchRecord\(currentBranch\)\) \{/,
  'draft restoration must validate the current row with the same metadata rule')
assert.match(form, /id="branch-name"[\s\S]*?readOnly[\s\S]*?aria-readonly="true"/,
  'branch name must be presented as a read-only identity')
assert.doesNotMatch(form, /id="branch-active"/,
  'the form must not expose canonical activation as an editable field')

const ts = createRequire(import.meta.url)('typescript')
const tree = ts.createSourceFile('Branches.tsx', branches, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const rule = tree.statements.find((node: any) => ts.isFunctionDeclaration(node) && node.name?.text === 'canEditBranchRecord')
assert.ok(rule, 'execute the actual metadata eligibility helper')
const compiled = ts.transpileModule(rule.getText(tree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const canEditBranchRecord = new Function('branchRoleFromName', `${compiled}; return canEditBranchRecord`)(branchRoleFromName)
const buttonGuard = branches.match(/\{(canEditBranch && canEditBranchRecord\(branch\)) \? <button/)
assert.ok(buttonGuard, 'execute the actual button permission and row guard')
const showEdit = new Function('canEditBranch', 'canEditBranchRecord', 'branch', `return ${buttonGuard[1]}`)
const active = { name: 'LC Store', canonical_key: 'warehouse', role: 'shop', is_active: 1, successor_branch_id: null }
const retired = { name: 'Old Shop', canonical_key: 'shop', role: 'shop', is_active: 0, successor_branch_id: 2 }
const cases: Array<[string, Record<string, unknown>, boolean]> = [
  ['renamed active canonical branch', active, true],
  ['retired canonical branch with successor', retired, true],
  ['legacy active canonical branch', { name: 'Shop', is_active: 1 }, true],
  ['unrecognized branch', { ...active, canonical_key: 'unknown' }, false],
  ['unrecognized explicit role', { ...active, role: 'unknown' }, false],
  ['active branch with successor', { ...active, successor_branch_id: 2 }, false],
  ['inactive branch without successor', { ...retired, successor_branch_id: null }, false],
  ['inactive branch with invalid successor', { ...retired, successor_branch_id: 0 }, false],
]
for (const [label, branch, eligible] of cases) {
  assert.equal(showEdit(true, canEditBranchRecord, branch), eligible, label)
  assert.equal(showEdit(false, canEditBranchRecord, branch), false, `${label} cannot bypass edit permission`)
}

console.log('PASS branch management exposes canonical metadata edits without create/delete selection controls')
console.log('PASS actual metadata guard covers eight active/retired identity cases with and without edit permission')
