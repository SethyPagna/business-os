// Regression lock-ins for the Aug-31 security batch (AUDIT-B): three real
// gaps that shipped to production because the green suite had NO test covering
// them. Each assertion below pins the FIXED shape so a future edit that
// silently reintroduces the hole fails CI instead of shipping unnoticed.
//
//   H1 products.ts /rename-brand  -- review-tier privilege escalation
//   H2 sync.ts chunked upload     -- library-permission bypass
//   M1 index.ts /ws               -- unauthenticated event-bus subscription
//
// Source-lock style (same as test-route-permissions-pure.cjs): these grep the
// real handler source, which is exactly where each hole lived.
//
// Run: node scripts/test-security-batch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Source-lock distances and newline anchors describe code, not the host
// checkout convention. Normalize CRLF so isolated Windows worktrees certify
// the same source shape as the shared LF checkout.
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n')

// ---- H1: /rename-brand must require Full manage_lookups, not edit!=='none' ----
{
  const products = read('src', 'routes', 'products.ts')
  // The gate inside the /rename-brand handler must be the Full manage_lookups
  // rule (matching its sibling POST /lookups/replace), reachable within the
  // handler body.
  assert.match(
    products,
    /app\.post\('\/rename-brand'[\s\S]{0,600}?getActionTier\(user, 'products', 'manage_lookups'\) !== 'full'/,
    'H1: /rename-brand must gate on Full manage_lookups (like /lookups/replace)',
  )
  // And must NOT be the old edit-tier gate a Review Required user passes.
  assert.doesNotMatch(
    products,
    /app\.post\('\/rename-brand'[\s\S]{0,600}?getActionTier\(user, 'products', 'edit'\) === 'none'/,
    'H1: /rename-brand must NOT gate on edit!==none (that let a Review Required user bypass the queue)',
  )
  // /lookups/replace itself must keep the same Full manage_lookups rule the
  // fix now matches (so the two cannot drift apart).
  assert.match(
    products,
    /app\.post\('\/lookups\/replace'[\s\S]{0,300}?getActionTier\(user, 'products', 'manage_lookups'\) !== 'full'/,
    'H1: /lookups/replace must keep its Full manage_lookups gate (the rule /rename-brand now mirrors)',
  )
  console.log('PASS H1 routes/products.ts /rename-brand requires Full manage_lookups, no review-tier bypass')
}

// ---- H2: the offline chunked-upload routes are gone; files.ts keeps the library predicates ----
{
  const sync = read('src', 'routes', 'sync.ts')
  const files = read('src', 'routes', 'files.ts')
  assert.match(files, /export function hasFullLibraryAccess\(user: SessionUser\): boolean/, 'H2: files.ts must export hasFullLibraryAccess')
  assert.match(files, /export function canWireProductImages\(user: SessionUser\): boolean/, 'H2: files.ts must export canWireProductImages')
  assert.doesNotMatch(sync, /files\/chunks|SYNC_UPLOADS/, 'H2: sync.ts must not expose a chunked upload that bypasses the library gate')
  console.log('PASS H2 routes/sync.ts exposes no chunk-upload entry point')
}

// ---- M1: /ws must be session-gated, closing 4001 on unauth ----
{
  const index = read('src', 'index.ts')
  assert.match(index, /import \{ getSessionUser \} from '\.\/lib\/auth'/, 'M1: index.ts must import getSessionUser')
  // The handler must be async and resolve the staff session.
  assert.match(index, /app\.get\('\/ws', async \(c\) =>[\s\S]{0,900}?getSessionUser\(c\)/, 'M1: /ws must resolve the session via getSessionUser')
  // No session -> close 4001 (the code the client special-cases as invalid_session).
  assert.match(index, /app\.get\('\/ws', async \(c\) =>[\s\S]{0,1100}?if \(!user\)[\s\S]{0,260}?close\(4001/, 'M1: /ws must close 4001 when there is no session')
  // The BroadcastHub proxy must only be reached AFTER the session check.
  assert.match(index, /getSessionUser\(c\)[\s\S]{0,400}?broadcastHubStub\(c\.env\)/, 'M1: the BroadcastHub proxy must come AFTER the session check, not before')
  console.log('PASS M1 index.ts /ws is session-gated and closes 4001 for unauthenticated clients')
}

console.log('\nAll security-batch regression checks passed.')
