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
  'the one Resolve control must use the combined merge capability',
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

// Resolve (R12): the grid opens, restores and writes only with the combined
// grant as it is NOW -- read through a ref, never a render's snapshot.
assert.match(
  duplicatesUi,
  /const canMergeDuplicatesRef = useRef\(canMergeDuplicates\)\s+canMergeDuplicatesRef\.current = canMergeDuplicates/,
  'the Resolve grid must read the live combined merge grant',
)
const resolveHandlers = duplicatesUi.slice(
  duplicatesUi.indexOf('const openResolve ='),
  duplicatesUi.indexOf('const toggleSelected ='),
)
assert.match(
  resolveHandlers,
  /const openResolve = useCallback\(\(target: ContactTableKind, cluster: ContactDuplicateCluster, draft\?: ResolveDraft\) => \{\s*if \(!canMergeDuplicatesRef\.current\) return/,
  'opening the Resolve grid must refuse stale or programmatic calls after bulk or merge permission is lost',
)
assert.match(
  resolveHandlers,
  /canMerge: \(\) => canMergeDuplicatesRef\.current/,
  'the grid must ask for the merge grant again right before it writes',
)
assert.match(
  resolveHandlers,
  /if \(!canMergeDuplicatesRef\.current \|\| \(parked\.table === 'suppliers' && !includeSuppliers\)\) \{\s*reparkDeniedRestore\(entry\)/,
  'a parked Resolve must not reopen without the merge grant, or a supplier group without supplier access',
)
assert.match(
  duplicatesUi,
  /useEffect\(\(\) => \{\s*if \(!canMergeDuplicates\) setResolving\(null\)\s*\}, \[canMergeDuplicates\]\)/,
  'losing the merge grant must close an open Resolve grid',
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

// The merge route runs up to the create route that follows it. The slice must
// end there: an end marker that is not found makes slice() run to the end of
// the file, and the checks below would then pass on any later route's code.
const mergeRouteStart = contactsRoute.indexOf('app.post(`${config.path}/merge`')
const mergeRouteEnd = contactsRoute.indexOf('app.post(config.path, async (c)', mergeRouteStart)
assert.ok(mergeRouteStart >= 0 && mergeRouteEnd > mergeRouteStart, 'the merge route and the route after it are found')
const mergeRoute = contactsRoute.slice(mergeRouteStart, mergeRouteEnd)
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
