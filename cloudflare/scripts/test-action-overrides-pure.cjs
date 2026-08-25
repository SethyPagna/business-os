// Per-action permission overrides.
//
// A tier answers "how much of Products may this role touch". Admins keep
// wanting the level below that -- "everything except Delete", "no Export" --
// without inventing a new tier for every combination. An override is stored
// alongside the ordinary keys under a `section:action` key:
//
//     { products: true, "products:delete": false }
//
// The rule that makes this safe, and the thing these assertions exist to
// protect, is that an override is ONE-WAY: it can only REMOVE an action the
// tier already granted, never add one the tier withholds.
//
// Widening would mean every route learning to accept "your tier says no, but
// an override says yes", and any route that forgot would silently disagree
// with the UI -- showing a button that 403s, or gating a write in the UI that
// the API still happily performs. Narrowing has no such failure mode: a route
// nobody has wired yet is simply no MORE permissive than before the feature
// existed, which is the direction a permission bug should fail in.
//
// Run: node scripts/test-action-overrides-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const repoRoot = path.join(cloudflareRoot, '..')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-override-'))
const tsPath = path.join(tmpDir, 'permissions.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'permissions.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { getActionTier, isActionBlocked, actionOverrideKey, getPermissionTier } = require(path.join(tmpDir, 'permissions.js'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

const role = (permissions) => ({ role_permissions: JSON.stringify(permissions), permissions: null, username: 'staff1', role_code: 'staff' })

check('an override removes a single action while the rest of the section keeps working', () => {
  const user = role({ products: true, 'products:delete': false })
  assert.equal(getPermissionTier(user, 'products'), 'full', 'the section itself is untouched')
  assert.equal(getActionTier(user, 'products', 'delete'), 'none', 'the overridden action is refused')
  assert.equal(getActionTier(user, 'products', 'edit'), 'full', 'every other action is unaffected')
})

check('an override CANNOT grant an action the tier withholds -- the one-way rule', () => {
  const user = role({ 'products:delete': true })
  assert.equal(getActionTier(user, 'products', 'delete'), 'none', 'no section grant means no action, whatever the override says')
  const alsoTrue = role({ products: false, 'products:edit': true })
  assert.equal(getActionTier(alsoTrue, 'products', 'edit'), 'none')
})

check('an override cannot upgrade a review tier to full', () => {
  const user = role({ products: 'review', 'products:edit': true })
  assert.equal(getActionTier(user, 'products', 'edit'), 'review', 'still review, not full')
})

check('only an explicit false counts -- a typo can never accidentally block', () => {
  for (const value of [true, 'yes', 1, 0, '', null, 'false']) {
    const user = role({ products: true, 'products:delete': value })
    assert.equal(
      isActionBlocked(user, 'products', 'delete'),
      false,
      `${JSON.stringify(value)} must not be treated as a block`,
    )
  }
  assert.equal(isActionBlocked(role({ products: true, 'products:delete': false }), 'products', 'delete'), true)
})

check('an admin is never narrowed -- locking yourself out would be unrecoverable', () => {
  const admin = { role_permissions: JSON.stringify({ all: true, 'products:delete': false }), permissions: null, username: 'owner', role_code: 'admin' }
  assert.equal(isActionBlocked(admin, 'products', 'delete'), false)
  assert.equal(getActionTier(admin, 'products', 'delete'), 'full')
})

check('a section with no override behaves exactly as before the feature existed', () => {
  const user = role({ products: 'review' })
  assert.equal(getActionTier(user, 'products', 'edit'), getPermissionTier(user, 'products'))
  assert.equal(getActionTier(user, 'products', 'anything-at-all'), 'review')
})

check('the override key format matches on both sides of the stack', () => {
  assert.equal(actionOverrideKey('products', 'delete'), 'products:delete')
  assert.equal(actionOverrideKey(' Products ', ' DELETE '), 'products:delete', 'case and padding are normalised')
  const frontend = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'utils', 'permissionActions.ts'), 'utf8')
  assert.match(
    frontend,
    /return `\$\{String\(section \|\| ''\)\.trim\(\)\.toLowerCase\(\)\}:\$\{String\(action \|\| ''\)\.trim\(\)\.toLowerCase\(\)\}`/,
    'frontend actionOverrideKey must produce the identical key, or an override set in the UI addresses a different key than the server reads',
  )
})

// ---------------------------------------------------------------------------
// Server-side enforcement. A per-action toggle that only hides a button is
// exactly the "looks wired but isn't" failure this project's own standards
// call out, so the routes must really consult it.
// ---------------------------------------------------------------------------
check('the Products routes gate on the ACTION, not just the section tier', () => {
  const src = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'products.ts'), 'utf8')
  const wired = [
    ['add', /getActionTier\(user, 'products', 'add'\)/],
    ['edit', /getActionTier\(user, 'products', 'edit'\)/],
    ['delete', /getActionTier\(user, 'products', 'delete'\)/],
    ['bulk_delete', /getActionTier\(user, 'products', 'bulk_delete'\)/],
    ['merge_duplicates', /getActionTier\(user, 'products', 'merge_duplicates'\)/],
    ['zero_qty_cleanup', /getActionTier\(user, 'products', 'zero_qty_cleanup'\)/],
    ['manage_lookups', /getActionTier\(user, 'products', 'manage_lookups'\)/],
  ]
  for (const [action, pattern] of wired) {
    assert.match(src, pattern, `products route for "${action}" should use getActionTier so an override is honoured server-side`)
  }
})

check('the editor writes the override rather than only rendering a badge', () => {
  const editor = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'components', 'users', 'PermissionEditor.tsx'), 'utf8')
  assert.match(editor, /toggleActionOverride/, 'each action row must be a real control')
  assert.match(editor, /next\[overrideKey\] = false/, 'switching off stores an explicit false')
  assert.match(
    editor,
    /if \(next\[overrideKey\] === false\) delete next\[overrideKey\]/,
    'handing an action back to the tier must DELETE the key, not write true -- a stale true would silently survive a later tier change',
  )
})

check('the app-wide action gate applies overrides too', () => {
  const ctx = fs.readFileSync(path.join(repoRoot, 'frontend', 'src', 'AppContext.tsx'), 'utf8')
  assert.match(ctx, /isActionOverriddenOff\(getPermissions\(\), section, action\)/, 'can() must consult overrides or the UI and API disagree')
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
