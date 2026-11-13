'use strict'
// W3 Slice A round 2 (review F6). A cache version is bumped by NAME and read by name; a name nobody reads is a bump that invalidates nothing. The
// delivery-contacts reset and bulk delete bumped 'deliveryContacts' (the BROADCAST channel's spelling) while every reader keys on the table name
// 'delivery_contacts' (routes/contacts.ts getContactReadCacheVersion(config.table), lib/cache.ts MAINTENANCE_CACHE_NAMESPACES), so those lists were
// never invalidated. AST census of every bumpVersion / bumpVersions call in cloudflare/src:
//   1. every string-literal namespace is one the readers use (KNOWN below, each proven against a reader of it in src);
//   2. every computed argument is on the classified list (a new one needs a line and a reason);
//   3. no argument is spelled from a BroadcastChannel / cacheKey / channel field (the typo class);
//   4. the contact-table names that readers use are exactly the ones the contact writers and the section reset bump.
// Run (from cloudflare/): node scripts/test-bump-namespaces-known-pure.cjs
// BUMP_SRC_ROOT=<dir containing src/> points it at another checkout (used for the required-red run on the old code).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = process.env.BUMP_SRC_ROOT || path.join(__dirname, '..')
const srcDir = path.join(root, 'src')
const files = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (full.endsWith('.ts')) files.push(full)
  }
})(srcDir)
const rel = (file) => path.relative(root, file).split(path.sep).join('/')

// Every namespace a writer may name, with the reader that proves it is read (a getVersion* / versionedKey call, a reader list, or the maintenance list).
const KNOWN = ['products', 'sales', 'returns', 'stock', 'settings', 'customers', 'suppliers', 'delivery_contacts', 'promotions', 'inventory', 'inventory_checks', 'audit_log']
// Computed arguments, each with the reason it is safe (its members are checked elsewhere in this file or in a named test).
const COMPUTED = {
  namespace: 'lib/cache.ts bumpVersion(env, namespace) wrapper; routes/contacts.ts loops its updateVersions list (members are table names, checked in 4)',
  MAINTENANCE_CACHE_NAMESPACES: 'lib/cache.ts list; every member is KNOWN (checked below)',
  RETURN_WRITE_CACHE_NAMESPACES: 'lib/returnCacheVersions.ts list; every member is KNOWN (checked below)',
  namespaces: 'routes/actionHistory.ts and lib/undoAppliers.ts: lists built from KNOWN literals (test-undo-redo-one-bump-native.cjs)',
  bumpNamespaces: 'routes/batches.ts: list built from KNOWN literals',
  'new Set(mergeVersions)': 'routes/contacts.ts: merge namespaces, literals and config.table',
  'config.table': 'routes/contacts.ts and lib/bulkDeleteEngine.ts: the contact / entity table name (checked in 4)',
  setBumps: 'routes/inventory.ts: list built from KNOWN literals',
  LOOKUP_CACHE_NAMESPACE: 'routes/lookups.ts: the lookup list namespace its own readers use',
  section: 'routes/system.ts reset-section: the section key IS the table name (checked in 4)',
  cacheNamespaces: 'routes/system.ts recovery list built from KNOWN literals',
}
const FORBIDDEN = /broadcastChannel|cacheKey|\.channel\b/

const literals = []
const computed = []
const readerLiterals = new Set()
const READER_CALL = /(^|\.)(getVersion|getVersionWithFallback|getVersionsWithFallback|versionedKey|getContactReadCacheVersion|readKvVersion)$/
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true)
  const strings = (node, out) => {
    if (ts.isStringLiteralLike(node)) out.push(node.text)
    ts.forEachChild(node, (child) => strings(child, out))
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf)
      if (/(^|\.)bumpVersions?$/.test(callee) && !rel(file).endsWith('lib/cache.ts')) {
        const arg = node.arguments[1]
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        if (arg) {
          const walk = (x) => {
            if (ts.isStringLiteralLike(x)) literals.push({ name: x.text, where: `${rel(file)}:${line}` })
            else if (ts.isArrayLiteralExpression(x)) x.elements.forEach(walk)
            else if (ts.isConditionalExpression(x)) { walk(x.whenTrue); walk(x.whenFalse) }
            else if (ts.isSpreadElement(x)) walk(x.expression)
            else computed.push({ text: x.getText(sf), where: `${rel(file)}:${line}`, file: rel(file) })
          }
          walk(arg)
        }
      }
      if (READER_CALL.test(callee)) for (const arg of node.arguments.slice(1)) { const out = []; strings(arg, out); out.forEach((value) => readerLiterals.add(value)) }
    }
    // Reader lists: a const whose name says it is a list of version namespaces (VERSION_NAMESPACES, PRODUCT_FILTERS_VERSIONS, MAINTENANCE_CACHE_NAMESPACES ...).
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /VERSION|NAMESPACES/.test(node.name.text) && node.initializer) {
      const out = []; strings(node.initializer, out); out.forEach((value) => readerLiterals.add(value))
    }
    // A contact config names the table its list is keyed on (routes/contacts.ts): readers call getContactReadCacheVersion(config.table).
    if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'table' && ts.isStringLiteralLike(node.initializer) && rel(file) === 'src/routes/contacts.ts') readerLiterals.add(node.initializer.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

let passed = 0
const check = (name, fn) => { fn(); passed += 1; console.log('PASS ' + name) }

check('every namespace named by a string literal in a bump is one a reader uses', () => {
  const unknown = literals.filter((entry) => !KNOWN.includes(entry.name))
  assert.deepEqual(unknown.map((entry) => `${entry.where} '${entry.name}'`), [], 'a bump of a name no reader keys on invalidates nothing (the BroadcastChannel spelling is not a version namespace)')
  const unread = [...new Set(literals.map((entry) => entry.name))].filter((name) => !readerLiterals.has(name))
  assert.deepEqual(unread, [], `bumped names with no reader found in src (a reader list, getVersion* call or contact table): ${unread.join(', ')}`)
})

check('every computed bump argument is classified, and none is spelled from a broadcast channel or cacheKey field', () => {
  const unclassified = computed.filter((entry) => !(entry.text in COMPUTED))
  assert.deepEqual(unclassified.map((entry) => `${entry.where} ${entry.text}`), [], 'a new computed namespace needs a line in COMPUTED with its reason')
  const forbidden = computed.filter((entry) => FORBIDDEN.test(entry.text))
  assert.deepEqual(forbidden.map((entry) => `${entry.where} ${entry.text}`), [], 'bump the version namespace (the table / section name), never the broadcast channel spelling')
})

check('the lists that name namespaces only name known ones', () => {
  const read = (file) => fs.readFileSync(path.join(srcDir, file), 'utf8')
  const names = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
  const maintenance = /export const MAINTENANCE_CACHE_NAMESPACES = \[([^\]]*)\]/.exec(read('lib/cache.ts'))
  assert.ok(maintenance, 'MAINTENANCE_CACHE_NAMESPACES exists')
  assert.deepEqual(names(maintenance[1]).filter((name) => !KNOWN.includes(name)), [])
  const returnsList = /RETURN_WRITE_CACHE_NAMESPACES = \[([^\]]*)\]/.exec(read('lib/returnCacheVersions.ts'))
  assert.deepEqual(names(returnsList[1]).filter((name) => !KNOWN.includes(name)), [])
})

check('the contact tables readers key on are the names the section reset and the bulk delete bump', () => {
  const system = fs.readFileSync(path.join(srcDir, 'routes/system.ts'), 'utf8')
  assert.match(system, /RESETTABLE_SECTIONS = \['customers', 'suppliers', 'delivery_contacts'\]/)
  assert.ok(/bumpVersion\(c\.env, section\)/.test(system), 'the section reset bumps the section key (the table name), not config.broadcastChannel')
  const bulk = fs.readFileSync(path.join(srcDir, 'lib/bulkDeleteEngine.ts'), 'utf8')
  assert.ok(/await bumpVersion\(env, config\.table\)/.test(bulk), 'the contacts bulk delete bumps the entity table name')
  for (const table of ['customers', 'suppliers', 'delivery_contacts']) assert.ok(readerLiterals.has(table), `a reader keys on ${table}`)
  assert.ok(!readerLiterals.has('deliveryContacts'), 'nothing reads a deliveryContacts version: it is only a broadcast channel')
})

console.log(`${passed} checks passed; ${literals.length} literal namespaces and ${computed.length} computed arguments across ${files.length} files.`)
