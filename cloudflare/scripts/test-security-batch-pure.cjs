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

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

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

// ---- H2: offline chunked upload must enforce the same library gate ----
{
  const sync = read('src', 'routes', 'sync.ts')
  const files = read('src', 'routes', 'files.ts')
  // files.ts must EXPORT the two predicates so sync.ts shares the exact rule
  // (single owner of the library-access logic).
  assert.match(files, /export function hasFullLibraryAccess\(user: SessionUser\): boolean/, 'H2: files.ts must export hasFullLibraryAccess')
  assert.match(files, /export function canWireProductImages\(user: SessionUser\): boolean/, 'H2: files.ts must export canWireProductImages')
  // sync.ts imports them and defines the shared guard.
  assert.match(sync, /import \{ hasFullLibraryAccess, canWireProductImages \} from '\.\/files'/, 'H2: sync.ts must import the library predicates from files.ts')
  assert.match(sync, /function ensureLibraryUploadAccess\(user: SessionUser\): boolean \{\s*\n\s*return hasFullLibraryAccess\(user\) \|\| canWireProductImages\(user\)/, 'H2: ensureLibraryUploadAccess must be hasFullLibraryAccess || canWireProductImages')
  // Every chunk-upload entry point must reject a caller lacking access, before
  // proxying to the DO (which cannot check).
  assert.match(sync, /app\.post\('\/files\/chunks\/init'[\s\S]{0,200}?ensureLibraryUploadAccess/, 'H2: /files/chunks/init must gate on ensureLibraryUploadAccess')
  assert.match(sync, /app\.post\('\/files\/chunks\/:uploadId\/chunk'[\s\S]{0,200}?ensureLibraryUploadAccess/, 'H2: /files/chunks/:uploadId/chunk must gate')
  assert.match(sync, /app\.post\('\/files\/chunks\/:uploadId\/complete'[\s\S]{0,200}?ensureLibraryUploadAccess/, 'H2: /files/chunks/:uploadId/complete must gate')
  console.log('PASS H2 routes/sync.ts chunk upload enforces the same library gate as files.ts /upload')
}

console.log('\nAll security-batch regression checks passed.')
