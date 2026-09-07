// Canonical branches are fixed identities. The former selection toolbar was
// useful only for bulk deletion, so keeping its select-all affordance after
// deletion became impossible would advertise a dead action.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const branches = fs.readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
const form = fs.readFileSync(new URL('../src/components/branches/BranchForm.tsx', import.meta.url), 'utf8')

assert.doesNotMatch(branches, /branches-select-all|selectedIds|handleBulkDelete|bulkDeleteBusy/,
  'fixed branch identities must not expose the obsolete bulk-delete selection mode')
assert.doesNotMatch(branches, /branchApi\.(createBranch|deleteBranch)\(|tr\('add_branch'|title=\{tr\('delete'/,
  'the branch page must not advertise create/delete actions rejected by the server')
assert.match(branches, /canEditBranch && branchRoleFromName\(branch\.name\) !== 'other' && !!branch\.is_active/,
  'only an active canonical row may expose metadata editing')
assert.match(form, /id="branch-name"[\s\S]*?readOnly[\s\S]*?aria-readonly="true"/,
  'branch name must be presented as a read-only identity')
assert.doesNotMatch(form, /id="branch-active"/,
  'the form must not expose canonical activation as an editable field')

console.log('PASS branch management exposes canonical metadata edits without create/delete selection controls')
