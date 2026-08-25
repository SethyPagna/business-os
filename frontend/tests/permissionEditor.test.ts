import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url), 'utf8')
const definitions = fs.readFileSync(new URL('../src/components/users/permissionDefinitions.ts', import.meta.url), 'utf8')
const permissionsUtil = fs.readFileSync(new URL('../src/utils/permissions.ts', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

assert.match(source, /PERMISSION_SECTIONS/)
assert.match(source, /from '\.\/permissionDefinitions'/)
assert.match(source, /permission_sensitive_critical/)
assert.match(source, /section\.permissions\.map/)
assert.match(definitions, /backup_restore/)
assert.match(definitions, /drive_credentials/)
assert.match(definitions, /business_identity/)
assert.match(definitions, /destructive_delete/)

const requiredKeys = [
  'perm_section_admin',
  'perm_section_operations',
  'perm_section_sensitive',
  'perm_backup_restore',
  'perm_business_identity',
  'perm_sales_policy',
  'perm_security_settings',
  'perm_drive_credentials',
  'perm_destructive_delete',
  'permission_sensitive_critical',
  'permission_sensitive_high',
  'permission_sensitive_normal',
]

for (const key of requiredKeys) {
  assert.ok(en[key], `English permission label missing: ${key}`)
  assert.ok(km[key], `Khmer permission label missing: ${key}`)
}

console.log('PASS PermissionEditor exposes page/action-sensitive permission groups with English/Khmer labels')

// Permissions step (4): the per-section Review Required tier picker.
// PermissionEditor.tsx must actually render a 3-way control (None/Review/
// Full) for a `tier: true` permission instead of falling back to the plain
// checkbox -- and must preserve a stored 'review' value through
// parsePermissionState instead of collapsing it to Boolean(value), the
// same bug class Users.tsx's normalizePermissionState was fixed for.
assert.match(source, /from '\.\.\/\.\.\/utils\/permissions\.ts'/)
assert.match(source, /REVIEW_TIER_KEYS/)
assert.match(source, /permission\.tier/)
assert.match(source, /setTier/)
assert.match(source, /raw === 'review' && REVIEW_TIER_KEYS\.has\(key\)/)
assert.match(source, /review_required/)
assert.match(source, /label_full_access/)

for (const key of ['none', 'review_required', 'label_full_access']) {
  assert.ok(en[key], `English tier-picker label missing: ${key}`)
  assert.ok(km[key], `Khmer tier-picker label missing: ${key}`)
}

// Cross-check permissionDefinitions.ts's `tier: true` flags against
// utils/permissions.ts's own REVIEW_TIER_KEYS set -- these two are meant
// to be kept in sync by hand (see both files' comments); this check turns
// a future drift between them into a failing test instead of a silent
// looks-wired-but-isn't gap.
const tierFlagKeys = [...definitions.matchAll(/key:\s*'([a-z_]+)'[^}]*tier:\s*true/g)].map((m) => m[1])
const reviewTierKeysMatch = permissionsUtil.match(/REVIEW_TIER_KEYS = new Set<string>\(\[([^\]]*)\]\)/)
assert.ok(reviewTierKeysMatch, 'REVIEW_TIER_KEYS set literal not found in utils/permissions.ts')
const reviewTierKeys = [...(reviewTierKeysMatch?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
assert.deepEqual(
  [...tierFlagKeys].sort(),
  [...reviewTierKeys].sort(),
  'permissionDefinitions.ts tier:true keys and utils/permissions.ts REVIEW_TIER_KEYS have drifted apart',
)

console.log('PASS PermissionEditor renders a None/Partial Access/Full Access tier picker for REVIEW_TIER_KEYS permissions, kept in sync with permissionDefinitions.ts')

// Per-row explanation, now through the shared InfoHint rather than a 4x4
// button carrying a `title`. The old affordance was the browser's own black
// tooltip: it does not open on tap at all, so on a touch device the
// explanation was simply unreachable, and the target was well under the
// minimum comfortable hit size. InfoHint opens on hover AND tap and
// deliberately carries no `title`, so there is no second overlapping panel.
assert.match(source, /import InfoHint from '\.\.\/shared\/InfoHint\.tsx'/)
assert.match(source, /reviewDescriptionFor/)
assert.match(source, /text=\{reviewDescriptionFor\(permission\)\}/)
assert.doesNotMatch(
  source,
  /title=\{reviewDescriptionFor\(permission\)\}/,
  'the tier explanation must not also be a native title tooltip -- that is the black duplicate',
)

// The tier picker is the primary control on this screen; it was px-2.5/py-1
// text-xs, which is what "very tiny various buttons" referred to.
assert.match(
  source,
  /min-w-\[5\.5rem\] px-3 py-2 text-sm font-semibold/,
  'tier buttons should be comfortably sized rather than text-xs',
)
assert.match(definitions, /reviewTKey\?:\s*string/)
assert.match(definitions, /reviewDescription\?:\s*string/)
assert.match(definitions, /reviewTKey:\s*'perm_fees_review_desc'/)

for (const key of ['review_required_generic_desc', 'perm_fees_review_desc']) {
  assert.ok(en[key], `English tier tooltip text missing: ${key}`)
  assert.ok(km[key], `Khmer tier tooltip text missing: ${key}`)
}

console.log('PASS PermissionEditor shows an info hint per tiered permission explaining exactly what Partial Access restricts for that section')

// Dashboard permission gate (previously PAGE_PERMISSIONS['dashboard'] was
// null -- any authenticated user, any role, could view it, and there was
// no separate control over the export button at all). Two plain boolean
// keys, not a tier:true/REVIEW_TIER_KEYS section -- Dashboard has no
// create/edit/delete workflow to queue for review, so 'dashboard' (page
// access) and 'dashboard_export' (export button) are independent
// Full/None grants, same shape as 'backup' vs 'backup_restore'.
assert.match(definitions, /key:\s*'dashboard'/)
assert.match(definitions, /key:\s*'dashboard_export'/)
assert.doesNotMatch(
  definitions.slice(definitions.indexOf("key: 'dashboard',"), definitions.indexOf("key: 'dashboard',") + 400),
  /tier:\s*true/,
  'dashboard permission section should stay a plain Full/None pair, not a tier:true Review Required section',
)

for (const key of ['perm_dashboard', 'perm_dashboard_export']) {
  assert.ok(en[key], `English permission label missing: ${key}`)
  assert.ok(km[key], `Khmer permission label missing: ${key}`)
}

const navigationConfigSource = fs.readFileSync(new URL('../src/components/shared/navigationConfig.ts', import.meta.url), 'utf8')
const appContextSource = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8')
assert.match(navigationConfigSource, /\{ id: 'dashboard', key: 'dashboard', permission: 'dashboard' \}/)
assert.match(appContextSource, /dashboard:\s*'dashboard'/)

const dashboardSource = fs.readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
assert.match(dashboardSource, /hasPermission\('dashboard_export'\)/, 'Dashboard export menu must stay gated behind the dashboard_export permission')

console.log('PASS Dashboard has its own page-access permission (default None for every non-admin role) plus an independent export-button permission')
