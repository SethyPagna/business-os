import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { PERMISSION_ACTIONS, isActionOverriddenOff } from '../src/utils/permissionActions.ts'
import { PERMISSION_SECTIONS } from '../src/components/users/permissionDefinitions.ts'
import { normalizePermissionState } from '../src/utils/permissions.ts'

const source = fs.readFileSync(new URL('../src/components/users/PermissionEditor.tsx', import.meta.url), 'utf8')
const definitions = fs.readFileSync(new URL('../src/components/users/permissionDefinitions.ts', import.meta.url), 'utf8')
const permissionsUtil = fs.readFileSync(new URL('../src/utils/permissions.ts', import.meta.url), 'utf8')
const en = JSON.parse(fs.readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'))
const km = JSON.parse(fs.readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'))

assert.match(source, /PERMISSION_SECTIONS/)
assert.match(source, /from '\.\/permissionDefinitions'/)
assert.match(source, /permission_sensitive_critical/)
assert.match(source, /section\.permissions\.map/)
assert.doesNotMatch(source, /<select\b/, 'permission choices use the shared dropdown, not a forbidden native select')
assert.match(source, /<AppSelect[\s\S]*ariaLabel=\{translate\('perm_sales_customer_mode'/, 'customer mode uses an accessible shared AppSelect')
const parsedEditor = ts.createSourceFile('PermissionEditor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let customerModeCallback = ''
function findModeCallback(node: ts.Node): void {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsedEditor) === 'AppSelect') {
    const change = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(parsedEditor) === 'onChange')
    if (change && ts.isJsxAttribute(change) && change.initializer && ts.isJsxExpression(change.initializer) && change.initializer.expression) {
      customerModeCallback = change.initializer.expression.getText(parsedEditor)
    }
  }
  ts.forEachChild(node, findModeCallback)
}
findModeCallback(parsedEditor)
assert.ok(customerModeCallback, 'the actual shared control has a mode callback')
const modeCallbackJs = ts.transpileModule(`const callback = ${customerModeCallback}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
for (const nameOnly of [false, true]) {
  const changes: unknown[] = []
  const callback = new Function('perms', 'isActionOverriddenOff', 'toggleActionOverride', `${modeCallbackJs}; return callback`)(
    nameOnly ? { 'sales:customer_reassign': false } : {}, isActionOverriddenOff, (...args: unknown[]) => changes.push(args),
  )
  callback(nameOnly ? 'name-only' : 'assignment')
  assert.equal(changes.length, 0, 'reselecting the current AppSelect option must not invert permission')
  callback(nameOnly ? 'assignment' : 'name-only')
  assert.deepEqual(changes, [['sales', 'customer_reassign']], 'changing option flips only the narrowing override')
}
assert.match(
  source,
  /translate\(`\$\{section\.tKey\}_desc`, section\.description\)/,
  'section descriptions must resolve their dynamic language-pack key before using the English fallback',
)
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

for (const key of [
  'perm_section_full_access_desc',
  'perm_section_pos_desc',
  'perm_section_sales_desc',
]) {
  assert.ok(en[key], `English permission-section description missing: ${key}`)
  assert.ok(km[key], `Khmer permission-section description missing: ${key}`)
  assert.notEqual(km[key], en[key], `Khmer permission-section description falls back to English: ${key}`)
}

console.log('PASS PermissionEditor exposes page/action-sensitive permission groups with English/Khmer labels')

// The per-section tier picker. PermissionEditor.tsx must render a 3-way control
// (None/Review/Full) for a `tier: true` permission instead of the plain checkbox,
// and must keep a stored 'review' value through parsePermissionState instead of
// collapsing it to Boolean(value), as Users.tsx's normalizePermissionState does.
assert.match(source, /from '\.\.\/\.\.\/utils\/permissions\.ts'/)
assert.match(source, /normalizePermissionState/)
assert.match(source, /permission\.tier/)
assert.match(source, /setTier/)
const ast = ts.createSourceFile('PermissionEditor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const parser = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'parsePermissionState')!
const compiled = ts.transpileModule(parser.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const parseEditor = new Function('normalizePermissionState', `${compiled}; return parsePermissionState`)(normalizePermissionState)
for (const raw of ['false', 'true', 1, [], {}, null]) {
  for (const value of [{ all: raw, products: raw }, JSON.stringify({ all: raw, products: raw })]) {
    assert.deepEqual(parseEditor(value), { all: false, products: false })
  }
}
assert.deepEqual(parseEditor({ products: 'review', sales: 'view', pos: true }), { products: 'review', sales: 'view', pos: true })
assert.deepEqual(parseEditor('[true]'), {})
assert.match(source, /review_required/)
assert.match(source, /label_full_access/)

for (const key of ['none', 'review_required', 'label_full_access']) {
  assert.ok(en[key], `English tier-picker label missing: ${key}`)
  assert.ok(km[key], `Khmer tier-picker label missing: ${key}`)
}

// Cross-check permissionDefinitions.ts's `tier: true` flags against
// utils/permissions.ts's tier-key sets. Every tier:true key must appear in
// exactly one of REVIEW_TIER_KEYS (amber "Review", queues writes) or
// VIEW_TIER_KEYS (teal "View", read-only) -- and vice versa. This turns
// a future drift into a failing test instead of a silent looks-wired-but-isn't
// gap. Part 557 added the 'view' flavor (Settings).
const tierFlagKeys = [...definitions.matchAll(/key:\s*'([a-z_]+)'[^}]*tier:\s*true/g)].map((m) => m[1])
const setLiteral = (name: string): string[] => {
  // "export const " prefix so VIEW_TIER_KEYS does not match inside
  // REVIEW_TIER_KEYS (substring trap).
  const m = permissionsUtil.match(new RegExp(`export const ${name} = new Set<string>\\(\\[([^\\]]*)\\]\\)`))
  assert.ok(m, `${name} set literal not found in utils/permissions.ts`)
  return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}
const reviewTierKeys = setLiteral('REVIEW_TIER_KEYS')
const viewTierKeys = setLiteral('VIEW_TIER_KEYS')
// A key is in AT MOST one middle-tier set.
const overlap = reviewTierKeys.filter((k) => viewTierKeys.includes(k))
assert.deepEqual(overlap, [], `keys in BOTH REVIEW_ and VIEW_TIER_KEYS: ${overlap.join(', ')}`)
// Every tier:true section is covered by one of the two sets, and every set
// member is a tier:true section (a middle-tier key that isn't tier:true would
// never render its picker).
assert.deepEqual(
  [...tierFlagKeys].sort(),
  [...reviewTierKeys, ...viewTierKeys].sort(),
  'permissionDefinitions.ts tier:true keys and utils/permissions.ts REVIEW_/VIEW_TIER_KEYS have drifted apart',
)
// Each view-tier section declares middleTier: 'view' so the editor renders
// the teal "View" option rather than the amber "Review".
for (const key of viewTierKeys) {
  assert.match(
    definitions,
    new RegExp(`key:\\s*'${key}'[\\s\\S]*?middleTier:\\s*'view'`),
    `view-tier section '${key}' must declare middleTier: 'view'`,
  )
}

for (const key of ['view_only']) {
  assert.ok(en[key], `English tier-picker label missing: ${key}`)
  assert.ok(km[key], `Khmer tier-picker label missing: ${key}`)
}

console.log('PASS PermissionEditor renders None/Review|View/Full tier pickers, kept in sync with REVIEW_/VIEW_TIER_KEYS')

// The per-row explanation goes through the shared InfoHint, which opens on hover and
// on tap and carries no `title`: a native tooltip never opens on touch, so the
// explanation would be unreachable there, and a second panel would overlap InfoHint's.
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
  /min-w-\[3\.75rem\] px-2\.5 py-1\.5 text-sm font-semibold/,
  'tier buttons should be comfortably sized rather than text-xs',
)
assert.match(definitions, /reviewTKey\?:\s*string/)
assert.match(definitions, /reviewDescription\?:\s*string/)
assert.match(definitions, /reviewTKey:\s*'perm_fees_review_desc'/)

for (const key of ['review_required_generic_desc', 'perm_fees_review_desc']) {
  assert.ok(en[key], `English tier tooltip text missing: ${key}`)
  assert.ok(km[key], `Khmer tier tooltip text missing: ${key}`)
}

console.log('PASS PermissionEditor shows an info hint per tiered permission explaining exactly what Review restricts for that section')

// Dashboard has two plain boolean keys, not a tier:true section: it has no
// create/edit/delete workflow to queue for review, so 'dashboard' (page access)
// and 'dashboard_export' (export button) are independent Full/None grants, the
// same shape as 'backup' vs 'backup_restore'.
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

// Action rows render under on/off keys (POS) through the same helper as under three-way sections, so the two
// branches cannot drift. Behaviour is pinned by the render cases in permissionEditorKhmer.test.ts.
assert.equal((source.match(/const renderActionRows = /g) || []).length, 1, 'one definition of the action panel')
assert.match(source, /renderActionRows\(permission, tier, 'mt-2'\)/, 'the three-way branch uses it')
assert.match(source, /renderActionRows\(permission, active \? 'full' : 'none'/, 'the on/off branch uses it, reading on as Full and off as None')
assert.equal((source.match(/renderActionRows\(permission, /g) || []).length, 2, 'exactly the two branches call it')
assert.match(source, /block break-words text-xs \$\{overriddenOff/, 'an action label wraps: the row carries no other copy of it, so an ellipsis would hide the words that explain the action')
assert.doesNotMatch(source, /truncate text-xs \$\{overriddenOff/)
console.log('PASS both editor branches share one action panel')

// The English fallback in the tables must be the pack's English, or the editor reads differently with and
// without a translator.
const sectionOf = (key: string) => PERMISSION_SECTIONS.find((section) => section.key === key)!
const permissionOf = (key: string) => PERMISSION_SECTIONS.flatMap((section) => section.permissions).find((permission) => permission.key === key)!
const actionOf = (section: string, key: string) => PERMISSION_ACTIONS[section].find((action) => action.key === key)!

assert.equal(en.perm_destructive_delete, 'Destructive imports: replace all and replace columns')
assert.equal(permissionOf('destructive_delete').label, en.perm_destructive_delete)
assert.equal(en.perm_act_products_import_replace_all, 'Import: replace all and replace columns')
assert.equal(actionOf('products', 'import_replace_all').label, en.perm_act_products_import_replace_all)
for (const key of ['perm_destructive_delete', 'perm_act_products_import_replace_all']) {
  assert.ok(km[key].includes('ជំនួសទាំងអស់') && km[key].includes('ជំនួសជួរឈរ'), `${key}: Khmer names both replace-all and replace-columns`)
}

assert.equal(en.perm_act_inventory_adjust, 'Adjust / receive stock')
assert.equal(actionOf('inventory', 'adjust').label, en.perm_act_inventory_adjust)
assert.equal(km.perm_act_inventory_adjust, 'កែតម្រូវ / ទទួលស្តុក')
assert.doesNotMatch(en.perm_act_inventory_adjust, /opening stock/i, 'a create that folds into an existing product ignores typed stock on this branch, so the label must not promise it')

assert.match(en.perm_act_products_merge_duplicates, /edits that merge/)
assert.equal(actionOf('products', 'merge_duplicates').label, en.perm_act_products_merge_duplicates)
assert.ok(km.perm_act_products_merge_duplicates.includes('បញ្ចូលគ្នាទិន្នន័យស្ទួន'), 'the Khmer row keeps the pack’s merge-duplicates name')

// The Products description says a merging edit is queued and what switching Merge duplicates off does, and says
// nothing about what approving it needs or does: the reviewer's merge permission is not checked on approval here.
assert.equal(permissionOf('products').reviewDescription, en.perm_products_review_desc)
assert.match(en.perm_products_review_desc, /edit that would merge this product into another one/)
assert.match(en.perm_products_review_desc, /unless Merge duplicates is switched off/)
assert.doesNotMatch(en.perm_products_review_desc, /Approving a merge|reviewer to hold/i)
assert.doesNotMatch(en.perm_products_review_desc, /approving it (?:performs|completes|applies)/i, 'must not promise the merge happens on approval')
assert.ok(km.perm_products_review_desc.includes('បញ្ចូលគ្នាទិន្នន័យស្ទួន') && km.perm_products_review_desc.includes('កម្រិតពិនិត្យ'))
assert.ok(!km.perm_products_review_desc.includes('ការអនុម័តការបញ្ចូលគ្នា'), 'the Khmer text drops the approval requirement too')

// The Review description states what approving needs.
assert.equal(sectionOf('review').description, en.perm_section_review_desc)
assert.equal(permissionOf('review').reviewDescription, en.perm_review_view_desc)
for (const fragment of [/Full Review access/, /own section and its exact action/, /price, image or cost permission/, /approve their own request/, /Rejecting needs only Full Review access/]) {
  assert.match(en.perm_section_review_desc, fragment)
}
assert.doesNotMatch(en.perm_section_review_desc, /Merge duplicates/, 'approval does not check the merge permission on this branch')
assert.match(en.perm_review_view_desc, /approving also needs Full access to each request’s own section and action/)
for (const key of ['perm_section_review_desc', 'perm_review_view_desc']) {
  assert.ok(km[key].includes('សិទ្ធិពេញលេញ'), `${key}: Khmer keeps Full Access as សិទ្ធិពេញលេញ`)
}
assert.ok(km.perm_section_review_desc.includes('ថ្លៃដើម') && !km.perm_section_review_desc.includes('តម្លៃដើម'), 'cost is ថ្លៃដើម, as the pack’s glossary pins')
assert.ok(!km.perm_section_review_desc.includes('បញ្ចូលគ្នាទិន្នន័យស្ទួន'))

// The replace-import refusal names the permission by the label the editor shows for it.
assert.ok(en.csv_replace_permission_required.includes(`“${en.perm_destructive_delete}”`), 'the English message quotes the editor label')
assert.ok(km.csv_replace_permission_required.includes(`«${km.perm_destructive_delete}»`), 'the Khmer message quotes the editor label')
assert.doesNotMatch(en.csv_replace_permission_required, /destructive-data/)
assert.ok(!km.csv_replace_permission_required.includes('សិទ្ធិលុបទិន្នន័យ'))
console.log('PASS the permission copy describes what ships in both packs and in the table fallbacks')
