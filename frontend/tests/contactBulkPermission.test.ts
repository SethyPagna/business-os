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
  assert.match(source, /const selectedIds = canBulkContacts \? contactSelection\.selectedIds : new Set<number>\(\)/, `${file} does not expose stale selection when bulk access is absent`)
  assert.match(source, /const selectionModeActive = canBulkContacts && contactSelection\.selectionModeActive/, `${file} keeps row and select-all checkboxes hidden`)
  assert.match(source, /const toggleOne = \(id: unknown\) => \{\s*if \(!canBulkContactsRef\.current\) return/, `${file} refuses direct row-selection calls`)
  assert.match(source, /const selectAllProp = \{[^]*?onChange: \(checked: boolean\) => \{\s*if \(!canBulkContactsRef\.current\) return/, `${file} refuses direct select-all calls`)
  assert.match(source, /if \(canBulkContacts\) return\s*setSelectedIds\(\(current\) => current\.size \? new Set<number>\(\) : current\)\s*setModal\(\(current\) => current === 'import' \? null : current\)/, `${file} clears selection and an open import modal after access is revoked`)
  assert.match(source, /const toggleSectionSelection = \([^]*?\{\s*if \(!canBulkContactsRef\.current\) return/, `${file} refuses grouped-section selection calls`)
  assert.match(source, /const handleBulkDelete = async \(\) => \{\s*if \(!canBulkContactsRef\.current \|\|/, `${file} refuses direct bulk-delete calls`)
  assert.match(source, /\.\.\.\(canBulkContacts \? \[\{ label: [^]*?setModal\('import'\)[^]*?\}\] : \[\]\)/, `${file} omits Import without bulk access`)
  assert.match(source, /\{\(canBulkContacts \|\| canExportContacts\) \? \(\s*<LazyPortalMenu/, `${file} does not leave an empty Manage control`)
  assert.match(source, /\{canBulkContacts && selectedIds\.size > 0 && canBulkDeleteContacts/, `${file} hides selected-action UI without bulk access`)
  assert.equal((source.match(/disabled: !canBulkContacts \|\| selectionModeActive/g) || []).length, 2, `${file} disables table and card long-press entry points`)
  assert.equal((source.match(/\.\.\.\(canBulkContacts && !selectionModeActive \? (?:row|card)LongPress : \{\}\)/g) || []).length, 2, `${file} does not attach long-press handlers without bulk access`)
  assert.match(source, /\{canBulkContacts && modal === 'import' \? \(/, `${file} refuses to mount the import modal without bulk access`)

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
assert.match(modal, /const canBulkContacts = can\('contacts', 'bulk'\)/)
assert.match(modal, /const canBulkContactsRef = useRef\(canBulkContacts\)\s*canBulkContactsRef\.current = canBulkContacts/)
assert.match(modal, /const ensureBulkContactsPermission = \(\): boolean => \{\s*if \(canBulkContactsRef\.current\) return true[^]*?return false\s*\}/)
assert.match(modal, /const handleApproveNow = async \([^]*?\) => \{\s*if \(!ensureBulkContactsPermission\(\)\) return\s*setApproving\(true\)/, 'manual and automatic approval fail closed')
assert.match(modal, /const handleImport = async \(\) => \{\s*if \(!ensureBulkContactsPermission\(\)\) return/, 'job creation fails closed')

const uploadStart = modal.indexOf('api.uploadImportJobCsv')
const startCall = modal.indexOf('api.startImportJob', uploadStart)
assert.ok(uploadStart >= 0 && startCall > uploadStart)
assert.match(modal.slice(uploadStart, startCall), /if \(!ensureBulkContactsPermission\(\)\) return/, 'permission is rechecked after upload and before starting the job')
assert.match(modal, /disabled=\{!canBulkContacts \|\| loading \|\| analyzingCsv \|\| !rowCount\}/, 'the import button is unavailable without bulk access')
assert.equal((modal.match(/approveImportJob\(/g) || []).length, 1, 'authorized approval behavior remains wired')
assert.equal((modal.match(/api\.startImportJob\(/g) || []).length, 1, 'authorized start behavior remains wired')

console.log('PASS Contacts selection, bulk delete, and import fail closed across all tabs and the import modal')
