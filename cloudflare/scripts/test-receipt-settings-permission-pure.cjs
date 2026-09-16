// Regression lock for the standalone Receipt Settings page's own permission
// key (Sep 16 2026 owner request: "Receipt settings should be in page menu
// as well" / "Receipt settings should also show for employees as well").
//
// Before this, the standalone page (ReceiptSettings.tsx / PrintSettings.tsx)
// gated on the blanket `settings` grant (AppContext.tsx's PAGE_PERMISSIONS),
// and routes/settings.ts's POST / write check fell through to the same
// blanket `settings` bucket for every receipt_* key -- so an Employee, who
// never carries `settings`, could neither open the page nor save a print
// mode change, even though receipt/print settings are a front-line
// operational tool, not an admin-only one.
//
// Mirrors test-portal-buckets-pure.cjs's technique: replicate the bucket map
// verbatim, assert the accept/reject matrix against it, then source-guard
// that settings.ts, coreDataInvariants.ts's default Employee role, and the
// frontend PAGE_PERMISSIONS/navigationConfig all agree on the same key.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`) }

// Copied verbatim from routes/settings.ts's RECEIPT_SETTINGS_KEYS.
const RECEIPT_SETTINGS_KEYS = new Set(['receipt_template', 'receipt_footer', 'receipt_print_settings'])

function bucketFor(key) {
  if (RECEIPT_SETTINGS_KEYS.has(key)) return 'receipt_settings'
  return null
}
// bucket grant OR settings (admin folds into a caller's grant set upstream,
// same contract as settings.ts's real missingBucket check).
const canWrite = (key, grants) => {
  const b = bucketFor(key)
  if (!b) return grants.has('settings')
  return grants.has(b) || grants.has('settings')
}

check('every receipt-settings key maps to the receipt_settings bucket', () => {
  assert.equal(bucketFor('receipt_template'), 'receipt_settings')
  assert.equal(bucketFor('receipt_footer'), 'receipt_settings')
  assert.equal(bucketFor('receipt_print_settings'), 'receipt_settings')
  assert.equal(bucketFor('business_name'), null, 'an unrelated key is not swept into this bucket')
})

check('Employee session (receipt_settings: true, no settings grant) can save every receipt key', () => {
  // Exact shape of coreDataInvariants.ts's DEFAULT_ROLE_PERMISSIONS.employee.
  const employeeGrants = new Set(['receipt_settings'])
  for (const key of RECEIPT_SETTINGS_KEYS) {
    assert.equal(canWrite(key, employeeGrants), true, `Employee must be able to save ${key}`)
  }
})

check('a role with the key removed is refused (403) on every receipt key', () => {
  const strippedGrants = new Set(['pos', 'sales']) // receipt_settings explicitly not present
  for (const key of RECEIPT_SETTINGS_KEYS) {
    assert.equal(canWrite(key, strippedGrants), false, `a role without receipt_settings must be refused for ${key}`)
  }
})

check('full settings is a superset (admin/settings-full user unaffected)', () => {
  const g = new Set(['settings'])
  for (const key of RECEIPT_SETTINGS_KEYS) assert.equal(canWrite(key, g), true)
})

check('other settings endpoints are unaffected by a receipt_settings-only grant', () => {
  const g = new Set(['receipt_settings'])
  // business_identity / sales_policy / plain settings keys stay gated on
  // their own buckets -- a receipt_settings grant must not widen them.
  assert.equal(canWrite('business_name', g), false)
  assert.equal(canWrite('tax_rate', g), false)
  assert.equal(canWrite('ui_theme', g), false)
})

check('no grant writes nothing', () => {
  const g = new Set()
  for (const key of RECEIPT_SETTINGS_KEYS) assert.equal(canWrite(key, g), false)
})

// --- source guards -----------------------------------------------------
const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
const coreDataSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'coreDataInvariants.ts'), 'utf8')
const appContextSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'AppContext.tsx'), 'utf8')
const navConfigSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'shared', 'navigationConfig.ts'), 'utf8')
const permDefsSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'users', 'permissionDefinitions.ts'), 'utf8')

function extractSet(src, name) {
  const m = src.match(new RegExp(`${name}\\s*=\\s*new Set(?:<string>)?\\(\\[([\\s\\S]*?)\\]\\)`))
  assert.ok(m, `${name} not found`)
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}

check('settings.ts RECEIPT_SETTINGS_KEYS matches this test', () => {
  assert.deepEqual(extractSet(settingsSrc, 'RECEIPT_SETTINGS_KEYS'), [...RECEIPT_SETTINGS_KEYS].sort())
})

check('settings.ts settingsBucketPermissionFor routes receipt keys through the receipt_settings bucket', () => {
  assert.match(settingsSrc, /if \(RECEIPT_SETTINGS_KEYS\.has\(key\)\) return 'receipt_settings'/)
})

check('coreDataInvariants.ts default Employee role carries receipt_settings: true', () => {
  const employeeBlock = coreDataSrc.match(/employee:\s*\{([\s\S]*?)\n\s*\},/)
  assert.ok(employeeBlock, 'DEFAULT_ROLE_PERMISSIONS.employee block not found')
  assert.match(employeeBlock[1], /receipt_settings:\s*true,/, 'Employee default must grant receipt_settings')
})

check('AppContext.tsx PAGE_PERMISSIONS gates receipt_settings on its own key, not the blanket settings grant', () => {
  assert.match(appContextSrc, /receipt_settings:\s*'receipt_settings',/)
})

check('navigationConfig.ts NAV_ITEMS matches the page-load guard and no longer hides the page in the nav menu', () => {
  assert.match(navConfigSrc, /\{ id: 'receipt_settings', key: 'receipt_settings', permission: 'receipt_settings' \}/)
  const accountNavIdsMatch = navConfigSrc.match(/ACCOUNT_NAV_IDS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(accountNavIdsMatch)
  assert.doesNotMatch(accountNavIdsMatch[1], /'receipt_settings'/, 'receipt_settings must render as a normal page-menu entry, not be hidden into the account-only set')
})

check('permissionDefinitions.ts exposes a grantable receipt_settings row so an admin can still turn it off per role', () => {
  assert.match(permDefsSrc, /key: 'receipt_settings', tKey: 'perm_receipt_settings'/)
})

console.log(`\nALL ${passed} CHECKS PASSED`)
