import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PERMISSION_ACTIONS,
  actionsForKey,
  outcomeAt,
  actionAllowed,
} from '../src/utils/permissionActions.ts'
import { REVIEW_TIER_KEYS } from '../src/utils/permissions.ts'

// --- 1. structural invariants ------------------------------------------

for (const [permissionKey, actions] of Object.entries(PERMISSION_ACTIONS)) {
  assert.ok(
    REVIEW_TIER_KEYS.has(permissionKey),
    `PERMISSION_ACTIONS has a per-action table for '${permissionKey}', which is not a review-tier key -- the tier column would be meaningless there`,
  )
  assert.ok(actions.length > 0, `'${permissionKey}' has an empty action list`)
  const seen = new Set<string>()
  for (const action of actions) {
    assert.ok(!seen.has(action.key), `'${permissionKey}' has duplicate action key '${action.key}'`)
    seen.add(action.key)
    assert.ok(action.label.trim(), `'${permissionKey}.${action.key}' has an empty label`)
    assert.ok(action.tKey.trim(), `'${permissionKey}.${action.key}' has an empty translation key`)
  }
  // Every section a person can reach must expose a view action, otherwise
  // the matrix implies the page itself is unreachable at that tier.
  assert.ok(seen.has('view'), `'${permissionKey}' is missing a 'view' action row`)
}

// Every review-tier key should have an action table -- a tier key without
// one silently falls back to the coarse "anything but none is allowed"
// path in actionAllowed(), which is exactly the looks-wired-but-isn't gap
// this table exists to close.
for (const key of REVIEW_TIER_KEYS) {
  assert.ok(
    PERMISSION_ACTIONS[key],
    `review-tier key '${key}' has no per-action table in permissionActions.ts`,
  )
}

console.log('PASS per-action tables are structurally sound and cover every review-tier key')

// --- 2. tier semantics --------------------------------------------------

const viewProducts = actionsForKey('products').find((a) => a.key === 'view')!
assert.equal(outcomeAt(viewProducts, 'none'), 'block', 'none must block even a view action')
assert.equal(outcomeAt(viewProducts, 'review'), 'allow')
assert.equal(outcomeAt(viewProducts, 'full'), 'allow')

// 'none' blocks every action of every section, with no exceptions.
for (const [permissionKey, actions] of Object.entries(PERMISSION_ACTIONS)) {
  for (const action of actions) {
    assert.equal(
      outcomeAt(action, 'none'),
      'block',
      `${permissionKey}.${action.key} must be blocked at the 'none' tier`,
    )
    assert.equal(
      actionAllowed(permissionKey, action.key, 'none'),
      false,
      `${permissionKey}.${action.key} must not be allowed at the 'none' tier`,
    )
  }
}

// 'queue' and 'limited' are usable -- the control stays available, the
// outcome differs. Only 'block' takes the button away.
assert.equal(actionAllowed('products', 'add', 'review'), true, 'a queued action is still submittable')
assert.equal(actionAllowed('contacts', 'edit', 'review'), true, 'a limited edit is still usable')
assert.equal(actionAllowed('products', 'export', 'review'), false, 'export is blocked under Review Required')
assert.equal(actionAllowed('products', 'bulk_delete', 'review'), false)
assert.equal(actionAllowed('inventory', 'adjust', 'review'), false)
assert.equal(actionAllowed('branches', 'transfer', 'review'), false)
assert.equal(actionAllowed('returns', 'edit', 'review'), false)
assert.equal(actionAllowed('contacts', 'delete', 'review'), false)

// Fees is the permissive one: only delete needs approval.
assert.equal(actionAllowed('fees', 'add', 'review'), true)
assert.equal(actionAllowed('fees', 'edit', 'review'), true)
assert.equal(outcomeAt(actionsForKey('fees').find((a) => a.key === 'delete')!, 'review'), 'queue')

// Returns allows create directly but never edit.
assert.equal(outcomeAt(actionsForKey('returns').find((a) => a.key === 'add')!, 'review'), 'allow')

console.log('PASS tier semantics match each route\'s real behavior')

// --- 3. requiresKey ------------------------------------------------------

// Full Access to Products is NOT enough for "replace all" -- it also needs
// destructive_delete, matching routes/importJobs.ts.
assert.equal(
  actionAllowed('products', 'import_replace_all', 'full', () => false),
  false,
  'replace-all must be denied without the destructive_delete grant, even at Full Access',
)
assert.equal(
  actionAllowed('products', 'import_replace_all', 'full', (key) => key === 'destructive_delete'),
  true,
  'replace-all must be allowed at Full Access once destructive_delete is granted',
)
// requiresKey must never resurrect a blocked action.
assert.equal(
  actionAllowed('products', 'import_replace_all', 'review', () => true),
  false,
  'replace-all stays blocked under Review Required regardless of destructive_delete',
)

console.log('PASS requiresKey is enforced on top of the tier, never instead of it')

// --- 4. unknown action keys ---------------------------------------------

// A typo'd action key must not silently deny (which would look like a
// permission bug); it falls back to the plain tier check.
assert.equal(actionAllowed('products', 'no_such_action', 'full'), true)
assert.equal(actionAllowed('products', 'no_such_action', 'none'), false)
assert.equal(actionAllowed('no_such_section', 'anything', 'review'), true)

console.log('PASS unknown action keys fall back to the tier check rather than silently denying')

// --- 5. the table must stay in sync with the real routes -----------------
//
// Guards the specific claims most likely to rot: if someone later changes
// one of these routes from a hard 403 to a queue (or the reverse) without
// updating the table, the UI would start advertising the wrong thing and
// the button gating would follow it. Matching on the distinctive guard
// text rather than line numbers so ordinary edits above don't break this.

const routeSource = (name: string) => readFileSync(
  new URL(`../../cloudflare/src/routes/${name}`, import.meta.url),
  'utf8',
)

const productsRoute = routeSource('products.ts')
assert.match(
  productsRoute,
  /Bulk delete requires Full access for Products/,
  'products bulk-delete is documented as blocked under review -- that 403 is gone from the route',
)
assert.match(
  productsRoute,
  /maybeQueueForReview\(c\.env, user, 'products'/,
  'products add/edit/delete are documented as queueing -- no maybeQueueForReview call found',
)

const feesRoute = routeSource('fees.ts')
assert.match(
  feesRoute,
  /maybeQueueForReview\(c\.env, user, 'fees'/,
  'fees delete is documented as queueing -- no maybeQueueForReview call found',
)

const contactsRoute = routeSource('contacts.ts')
assert.match(
  contactsRoute,
  /tier === 'review' \? \['name'\]/,
  "contacts edit is documented as name-only under review -- that column narrowing is gone",
)

const inventoryRoute = routeSource('inventory.ts')
assert.match(
  inventoryRoute,
  /maybeQueueForReview\(c\.env, user, 'inventory'/,
  'inventory reasons-list edit is documented as queueing -- no maybeQueueForReview call found',
)

console.log('PASS per-action table still matches the real route guards')
console.log('permissionActions tests passed')
