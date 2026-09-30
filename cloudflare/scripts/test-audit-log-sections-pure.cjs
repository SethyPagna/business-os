// Audit-log sections: the ONE entity/action -> section table (lib/auditSections.ts).
//
// The owner asked for the audit log to be organisable "all, or by sections".
// A section is derived on the Worker, from a single mapping table, so the page,
// the section filter and the per-section counts can never disagree about which
// area an event belongs to. This test pins:
//   - the mapping itself (entity first, then table_name, then the entity-less
//     action fallback, else 'other');
//   - COVERAGE: every entity the Worker actually writes (audit() call sites
//     with a literal entity, plus the raw-SQL writers) resolves to a real
//     section, so a newly added writer cannot silently land in 'other';
//   - the mapping is a function, not a multimap (an entity in two sections
//     would count twice in the per-section aggregate);
//   - the frontend's entity vocabulary is covered too.
//
// Run: node scripts/test-audit-log-sections-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-sections-'))
const tsPath = path.join(tmpDir, 'auditSections.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'auditSections.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const sections = require(path.join(tmpDir, 'auditSections.js'))
const { auditSectionOf, AUDIT_SECTION_IDS, AUDIT_ENTITY_SECTION } = sections

// ---- the mapping -----------------------------------------------------------
assert.deepEqual([...AUDIT_SECTION_IDS].sort(),
  ['contacts', 'expenses', 'products', 'returns', 'sales', 'settings', 'system', 'users', 'website'],
  'the owner-named sections and nothing else')
ok(auditSectionOf('sale', 'sales', 'update') === 'sales', 'a sale is Sales')
ok(auditSectionOf('product', null, 'stock_set') === 'products', 'a product stock change is Products')
ok(auditSectionOf('customer', 'customers', 'update') === 'contacts', 'a customer is Contacts')
ok(auditSectionOf('user', null, 'login') === 'users', 'a login is Users')
ok(auditSectionOf('role', null, 'create') === 'users', 'a role is Users (permissions)')
ok(auditSectionOf('settings', null, 'update') === 'settings', 'settings is Settings')
ok(auditSectionOf('fee', null, 'create') === 'expenses', 'a fee is Expenses')
ok(auditSectionOf('return_create', 'returns', 'create') === 'returns', 'a return create row is Returns')
ok(auditSectionOf('backup', null, 'restore') === 'system', 'a backup is System')
ok(auditSectionOf('  SALE ', null, 'x') === 'sales', 'entity is trimmed and case-insensitive')
ok(auditSectionOf('', 'products', 'update') === 'products', 'table_name answers when the entity is empty (legacy rows)')
ok(auditSectionOf('sale', 'products', 'update') === 'sales', 'the entity wins over table_name')
ok(auditSectionOf('never_heard_of_it', null, 'update') === 'other', 'an unknown entity is other, not a guess')
ok(auditSectionOf('never_heard_of_it', 'sales', 'update') === 'other', 'an unknown entity does not borrow the table_name section')
ok(auditSectionOf(null, null, 'login') === 'users', 'an entity-less login falls back to the action table')
ok(auditSectionOf(null, null, 'mystery_action') === 'other', 'an entity-less unknown action is other')
ok(auditSectionOf(null, null, null) === 'other', 'a fully empty row is other')

// ---- a function, not a multimap -------------------------------------------
{
  const groups = sections.AUDIT_SECTION_ENTITIES
  const seen = new Map()
  for (const [section, entities] of Object.entries(groups)) {
    for (const entity of entities) {
      assert.ok(!seen.has(entity), `entity ${entity} is listed in both ${seen.get(entity)} and ${section}`)
      assert.equal(entity, entity.toLowerCase().trim(), `entity ${entity} must be stored lower-case and trimmed`)
      seen.set(entity, section)
    }
  }
  ok(seen.size === Object.keys(AUDIT_ENTITY_SECTION).length, 'the flattened lookup has exactly the grouped entities')
}

// ---- coverage: every entity the Worker writes maps to a real section -------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}
function splitArgs(source, start) {
  let depth = 0
  let current = ''
  const args = []
  let quote = null
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      current += ch
      if (ch === '\\') { current += source[i + 1]; i += 1; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue }
    if ('([{'.includes(ch)) { depth += 1; current += ch; continue }
    if (')]}'.includes(ch)) {
      if (depth === 0) { args.push(current.trim()); return args }
      depth -= 1
      current += ch
      continue
    }
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; continue }
    current += ch
  }
  return args
}
const literal = (arg) => /^'([^']*)'$/.exec(arg || '')?.[1]

const pairs = new Map()
for (const file of walk(path.join(cloudflareRoot, 'src'))) {
  const source = fs.readFileSync(file, 'utf8')
  const call = /\baudit\(/g
  let match
  while ((match = call.exec(source))) {
    const args = splitArgs(source, match.index + match[0].length)
    if (args.length < 5) continue
    const entity = literal(args[4])
    if (entity) pairs.set(`${literal(args[3]) || '<dynamic>'} | ${entity}`, entity)
  }
}
ok(pairs.size >= 80, `the scan found the audit() call sites (${pairs.size} distinct action|entity pairs)`)

// Writers that insert with raw SQL (batched with their own mutation) and
// writers whose entity is a variable; listed so the coverage is not blind to
// them. The scan above cannot see these.
const SQL_WRITER_ENTITIES = [
  'sale', 'sale_creation', 'product', 'customer', 'return', 'return_create', 'fee', 'stock',
  'stock_session', 'stock_transfer', 'shift_session', 'payment_method', 'pos_address_presets',
  'import_job', 'action_history',
]
const DYNAMIC_ENTITIES = ['customer', 'supplier', 'delivery_contact', 'brand', 'category', 'unit']
const covered = new Set([...pairs.values(), ...SQL_WRITER_ENTITIES, ...DYNAMIC_ENTITIES])
const unmapped = [...covered].filter((entity) => auditSectionOf(entity, null, 'x') === 'other')
ok(unmapped.length === 0, `every written entity maps to a section (unmapped: ${unmapped.join(', ') || 'none'})`)

// Every audit() action with a literal entity lands in the same section as its entity.
for (const key of pairs.keys()) {
  const [action, entity] = key.split(' | ')
  assert.notEqual(auditSectionOf(entity, entity, action), 'other', `${key} must not be other`)
}
ok(true, 'every action|entity pair resolves through its entity')

// ---- the frontend vocabulary is covered too --------------------------------
{
  const vocabulary = fs.readFileSync(path.join(cloudflareRoot, '..', 'frontend', 'src', 'utils', 'auditVocabulary.ts'), 'utf8')
  const block = vocabulary.slice(vocabulary.indexOf('export const AUDIT_ENTITY_LABELS'))
  const keys = [...block.slice(0, block.indexOf('\n}')).matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1])
  ok(keys.length > 20, `read the frontend entity labels (${keys.length})`)
  const missing = keys.filter((key) => auditSectionOf(key, null, 'x') === 'other')
  ok(missing.length === 0, `every frontend-labelled entity has a section (missing: ${missing.join(', ') || 'none'})`)
}

console.log(`\nAll ${checks} audit-log section checks passed.`)
