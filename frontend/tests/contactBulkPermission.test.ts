import assert from 'node:assert/strict'
import fs from 'node:fs'

const tabs = [
  { file: 'CustomersTab.tsx', visibleRows: 'visibleCustomers' },
  { file: 'SuppliersTab.tsx', visibleRows: 'visibleSuppliers' },
  { file: 'DeliveryTab.tsx', visibleRows: 'visibleContacts' },
]

for (const { file, visibleRows } of tabs) {
  const source = fs.readFileSync(new URL(`../src/components/contacts/${file}`, import.meta.url), 'utf8')

  assert.match(source, /const canBulkContacts = can\('contacts', 'bulk'\)/, `${file} reads the contacts.bulk action`)
  assert.match(source, /const canBulkContactsRef = useRef\(canBulkContacts\)\s*canBulkContactsRef\.current = canBulkContacts/, `${file} keeps invocation-time permission current for saved history callbacks`)
  assert.match(source, /const canImportContacts = canBulkContacts && can\('contacts', 'import'\)/, `${file} requires both bulk and import actions for importing`)
  assert.match(source, /const canImportContactsRef = useRef\(canImportContacts\)\s*canImportContactsRef\.current = canImportContacts/, `${file} rechecks both import permissions at invocation time`)
  assert.match(source, /const selectedIds = canBulkContacts \? contactSelection\.selectedIds : new Set<number>\(\)/, `${file} does not expose stale selection when bulk access is absent`)
  assert.match(source, /const selectionModeActive = canBulkContacts && contactSelection\.selectionModeActive/, `${file} keeps row and select-all checkboxes hidden`)
  assert.match(source, /const toggleOne = \(id: unknown\) => \{\s*if \(!canBulkContactsRef\.current\) return/, `${file} refuses direct row-selection calls`)
  assert.match(source, /const selectAllProp = \{[^]*?onChange: \(checked: boolean\) => \{\s*if \(!canBulkContactsRef\.current\) return/, `${file} refuses direct select-all calls`)
  assert.match(source, /if \(canImportContacts\) return\s*setSelectedIds\(\(current\) => current\.size \? new Set<number>\(\) : current\)\s*setModal\(\(current\) => current === 'import' \? null : current\)/, `${file} clears selection and an open import modal after access is revoked`)
  assert.match(source, /const toggleSectionSelection = \([^]*?\{\s*if \(!canBulkContactsRef\.current\) return/, `${file} refuses grouped-section selection calls`)
  assert.match(source, /const handleBulkDelete = async \(\) => \{\s*if \(!canBulkContactsRef\.current \|\|/, `${file} refuses direct bulk-delete calls`)
  assert.match(source, /\.\.\.\(canImportContacts \? \[\{ label: [^]*?!canImportContactsRef\.current[^]*?setModal\('import'\)[^]*?\}\] : \[\]\)/, `${file} omits Import unless both action gates allow it`)
  if (file === 'CustomersTab.tsx') {
    assert.match(source, /\{\(canImportContacts \|\| canExportContacts \|\| canRestoreCustomerGender\) \? \(\s*<LazyPortalMenu/, 'Customers keeps Manage visible for its dedicated restoration action')
    assert.match(source, /const permission = effectivePermissions\(user\)[^]*?const canRestoreCustomerGender = permission\.isAdmin\s*&& permission\.getPermissionTier\('contacts'\) === 'full'\s*&& permission\.can\('contacts', 'edit'\)/, 'gender restoration requires administrator identity and Full contacts edit authority')
    assert.match(source, /const canRestoreCustomerGenderRef = useRef\(canRestoreCustomerGender\)\s*canRestoreCustomerGenderRef\.current = canRestoreCustomerGender/, 'restoration invocation rechecks current authority')
    assert.match(source, /\.\.\.\(canRestoreCustomerGender \? \[\{[^]*?!canRestoreCustomerGenderRef\.current[^]*?setModal\('gender-restoration'\)[^]*?\}\] : \[\]\)/, 'Customers omits and refuses restoration when its exact gate is absent')
    assert.match(source, /\{canRestoreCustomerGender && modal === 'gender-restoration' \? \(/, 'Customers refuses to mount restoration after authority is revoked')
  } else {
    assert.match(source, /\{\(canImportContacts \|\| canExportContacts\) \? \(\s*<LazyPortalMenu/, `${file} retains the original Import-or-Export Manage visibility`)
    assert.doesNotMatch(source, /canRestoreCustomerGender|gender-restoration/, `${file} does not inherit the customer-only restoration action`)
  }
  assert.match(source, /\{canBulkContacts && selectedIds\.size > 0 && canBulkDeleteContacts/, `${file} hides selected-action UI without bulk access`)
  assert.equal((source.match(/disabled: !canBulkContacts \|\| selectionModeActive/g) || []).length, 2, `${file} disables table and card long-press entry points`)
  assert.equal((source.match(/\.\.\.\(canBulkContacts && !selectionModeActive \? (?:row|card)LongPress : \{\}\)/g) || []).length, 2, `${file} does not attach long-press handlers without bulk access`)
  assert.match(source, /\{canImportContacts && modal === 'import' \? \(/, `${file} refuses to mount the import modal unless both action gates allow it`)

  const bulkStart = source.indexOf('const handleBulkDelete = async () =>')
  const bulkEnd = source.indexOf('\n  return (', bulkStart)
  assert.ok(bulkStart >= 0 && bulkEnd > bulkStart, `${file} bulk-delete history block is present`)
  const bulkBlock = source.slice(bulkStart, bulkEnd)
  assert.match(bulkBlock, /undo: async \(\) => \{\s*if \(!canBulkContactsRef\.current\) throw new Error/, `${file} bulk undo rechecks the current override`)
  assert.match(bulkBlock, /redo: async \(\) => \{\s*if \(!canBulkContactsRef\.current\) throw new Error/, `${file} bulk redo rechecks the current override`)

  assert.match(source, /const canExportContacts = can\('contacts', 'export'\)/, `${file} keeps export on its distinct action`)
  assert.match(source, new RegExp(`${visibleRows}\\.map\\(`), `${file} export still uses visible rows rather than contact selection`)
}

const modal = fs.readFileSync(new URL('../src/components/contacts/ContactImportModal.tsx', import.meta.url), 'utf8')
assert.match(modal, /const \{ notify, t, can \} = useApp\(\)/)
assert.match(modal, /const canImportContacts = can\('contacts', 'bulk'\) && can\('contacts', 'import'\)/)
assert.match(modal, /const canImportContactsRef = useRef\(canImportContacts\)\s*canImportContactsRef\.current = canImportContacts/)
assert.match(modal, /const ensureContactImportPermission = \(\): boolean => \{\s*if \(canImportContactsRef\.current\) return true[^]*?return false\s*\}/)
assert.match(modal, /const handleApproveNow = async \([^]*?\) => \{\s*if \(!ensureContactImportPermission\(\)\) return\s*setApproving\(true\)/, 'manual and automatic approval fail closed')
assert.match(modal, /const handleImport = async \(\) => \{\s*if \(!ensureContactImportPermission\(\)\) return/, 'job creation fails closed')

const uploadStart = modal.indexOf('api.uploadImportJobCsv')
const startCall = modal.indexOf('api.startImportJob', uploadStart)
assert.ok(uploadStart >= 0 && startCall > uploadStart)
assert.match(modal.slice(uploadStart, startCall), /if \(!ensureContactImportPermission\(\)\) return/, 'permission is rechecked after upload and before starting the job')
assert.match(modal, /disabled=\{!canImportContacts \|\| loading \|\| analyzingCsv \|\| !rowCount\}/, 'the import button is unavailable unless both action gates allow it')
assert.equal((modal.match(/approveImportJob\(/g) || []).length, 1, 'authorized approval behavior remains wired')
assert.equal((modal.match(/api\.startImportJob\(/g) || []).length, 1, 'authorized start behavior remains wired')

const duplicates = fs.readFileSync(new URL('../src/components/contacts/DuplicatesTab.tsx', import.meta.url), 'utf8')
assert.match(duplicates, /const canBulkContacts = can\('contacts', 'bulk'\)/)
assert.match(duplicates, /const canMergeDuplicates = canBulkContacts && canResolveConflicts && can\('contacts', 'merge'\)/, 'even one-cluster merge requires the bulk umbrella used by the server')
assert.match(duplicates, /if \(!canBulkContacts\) setSelectedKeys\(new Set\(\)\)/, 'revocation clears duplicate-cluster selection')
assert.match(duplicates, /const toggleSelected = \(id: string\) => \{\s*if \(!canBulkContactsRef\.current\) return/, 'cluster selection fails closed')
assert.match(duplicates, /const bulkDismiss = async \(\) => \{\s*if \(!canBulkContactsRef\.current\) return/, 'bulk dismiss fails closed while individual dismiss remains available')
assert.match(duplicates, /const bulkMerge = async \(\) => \{\s*if \(!canBulkContactsRef\.current \|\| !canMergeDuplicates\) return/, 'bulk merge fails closed')
assert.match(duplicates, /\{canBulkContacts && canResolveConflicts \? <button[^]*?select_all/, 'select-all is hidden without bulk access')
assert.match(duplicates, /selectable=\{canBulkContacts && canResolveConflicts && !bulkBusy\}/, 'cluster cards cannot enter selection without bulk access')
assert.match(duplicates, /canMergeDuplicates=\{canMergeDuplicates\}/, 'single-cluster merge uses the bulk-aware merge gate')
const individualDismiss = duplicates.slice(duplicates.indexOf('const handleDismiss = async'), duplicates.indexOf('const handleReopen = async'))
const individualReopen = duplicates.slice(duplicates.indexOf('const handleReopen = async'), duplicates.indexOf('const handleMergeInto = async'))
assert.doesNotMatch(individualDismiss, /canBulkContacts/, 'individual dismiss remains available')
assert.doesNotMatch(individualReopen, /canBulkContacts/, 'individual reopen remains available')

console.log('PASS Contacts selection, bulk delete, import, and duplicate actions fail closed across all surfaces')
