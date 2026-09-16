import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const duplicatesUi = readFileSync(
  new URL('../src/components/contacts/DuplicatesTab.tsx', import.meta.url),
  'utf8',
)
const contactsRoute = readFileSync(
  new URL('../../cloudflare/src/routes/contacts.ts', import.meta.url),
  'utf8',
)

assert.match(
  duplicatesUi,
  /const canResolveConflicts = can\('contacts', 'resolve_conflicts'\)\s+const canBulkContacts = can\('contacts', 'bulk'\)[\s\S]*?const canMergeDuplicates = canBulkContacts && canResolveConflicts && can\('contacts', 'merge'\)/,
  'duplicate merges must require bulk, conflict-resolution, and the dedicated Contacts merge action',
)

const clusterCard = duplicatesUi.slice(
  duplicatesUi.indexOf('function ClusterCard('),
  duplicatesUi.indexOf('export default function DuplicatesTab'),
)
assert.match(
  clusterCard,
  /canMergeDuplicates && cluster\.contacts\.length >= 2/,
  'each Keep this merge control must use the combined merge capability',
)
assert.match(
  clusterCard,
  /canResolveConflicts && cluster\.dismissed/,
  'reopen must remain available from the conflict-resolution capability',
)
assert.match(
  clusterCard,
  /\) : canResolveConflicts \? \(\s*<button[\s\S]*?setPendingAction\(\{ kind: 'dismiss' \}\)/,
  'dismiss must remain available from the conflict-resolution capability without requiring merge',
)

const mergeHandler = duplicatesUi.slice(
  duplicatesUi.indexOf('const handleMergeInto = async'),
  duplicatesUi.indexOf('const toggleSelected ='),
)
assert.match(
  mergeHandler,
  /if \(!canBulkContactsRef\.current \|\| !canMergeDuplicates\) return[\s\S]*?await mergeContacts\(/,
  'the individual merge handler must refuse stale or programmatic calls after bulk or merge permission is lost',
)

const bulkMergeHandler = duplicatesUi.slice(
  duplicatesUi.indexOf('const bulkMerge = async'),
  duplicatesUi.indexOf('const normalizedSearch ='),
)
assert.match(
  bulkMergeHandler,
  /if \(!canBulkContactsRef\.current \|\| !canMergeDuplicates\) return[\s\S]*?await mergeContacts\(/,
  'the bulk merge handler must refuse stale or programmatic calls after bulk or merge permission is lost',
)

const bulkToolbar = duplicatesUi.slice(
  duplicatesUi.indexOf('{canBulkContacts && canResolveConflicts && selectedKeys.size > 0 ? ('),
  duplicatesUi.indexOf('<div className="grid grid-cols-1'),
)
assert.match(
  bulkToolbar,
  /\{canMergeDuplicates \? \([\s\S]*?void bulkMerge\(\)[\s\S]*?\) : null\}[\s\S]*?void bulkDismiss\(\)/,
  'the bulk toolbar must hide Merge selected without merge access while retaining Dismiss selected',
)
assert.match(
  duplicatesUi,
  /selectable=\{canBulkContacts && canResolveConflicts && !bulkBusy\}/,
  'multi-cluster selection must require bulk while individual dismiss and reopen remain available',
)

const mergeRoute = contactsRoute.slice(
  contactsRoute.indexOf('app.post(`${config.path}/merge`'),
  contactsRoute.indexOf('// Backfill:', contactsRoute.indexOf('app.post(`${config.path}/merge`')),
)
assert.match(
  mergeRoute,
  /getPermissionTier\(user, 'contacts'\) === 'review'/,
  'the server merge route must continue to reject Contacts Review tier',
)
assert.match(
  mergeRoute,
  /getActionTier\(user, 'contacts', 'merge'\) === 'none'/,
  'the server merge route must continue to enforce the dedicated Contacts merge action',
)
assert.match(
  mergeRoute,
  /getActionTier\(user, 'contacts', 'bulk'\) === 'none'/,
  'the server merge route must enforce the Contacts bulk umbrella',
)
assert.match(
  contactsRoute,
  /denyUnlessFullContactAction\(c, 'resolve_conflicts'\)/,
  'dismiss and reopen routes must continue to enforce the distinct conflict-resolution action',
)

console.log('contact merge permission parity tests passed')
