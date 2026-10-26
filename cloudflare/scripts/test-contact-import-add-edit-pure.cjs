// PERMISSION-UI-HIDING#128 review fix P2-3: a contacts import creates rows (needs contacts:add) and updates rows
// (needs contacts:edit). The apply path judges each row against the authorizing user, skips a refused row with a
// coded message, and the route refuses a user who holds neither.
//
// Drives the REAL applyContactImportActionGates and getActionTier (extracted/transpiled from source), and pins the
// wiring around them.
//
// Run: node scripts/test-contact-import-add-edit-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const engine = fs.readFileSync(path.join(root, 'src', 'lib', 'importEngine.ts'), 'utf8').replace(/\r\n/g, '\n')
const routes = fs.readFileSync(path.join(root, 'src', 'routes', 'importJobs.ts'), 'utf8').replace(/\r\n/g, '\n')
const permissionsSource = fs.readFileSync(path.join(root, 'src', 'lib', 'permissions.ts'), 'utf8')

function transpile(source) {
  const module = { exports: {} }
  new Function('exports', 'module', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(module.exports, module)
  return module.exports
}
const { getActionTier } = transpile(permissionsSource)

const start = engine.indexOf('export const CONTACT_IMPORT_ADD_DENIED_CODE')
const end = engine.indexOf('export async function assertCurrentImportApplyAuthority')
assert.ok(start >= 0 && end > start, 'the gate is present in the engine')
const { applyContactImportActionGates, CONTACT_IMPORT_ADD_DENIED_CODE, CONTACT_IMPORT_EDIT_DENIED_CODE } = transpile(
  engine.slice(start, end).replace(/: ImportRowResult\[\]/g, ''),
)

const role = (map) => ({ role_code: 'employee', role_permissions: JSON.stringify(map), permissions: '{}' })
const rows = () => [
  { rowNumber: 1, action: 'create', message: null },
  { rowNumber: 2, action: 'update', message: null },
  { rowNumber: 3, action: 'skip', message: 'x' },
  { rowNumber: 4, action: 'error', message: 'bad' },
]
const allow = (user) => ({
  creates: getActionTier(user, 'contacts', 'add') !== 'none',
  updates: getActionTier(user, 'contacts', 'edit') !== 'none',
})
const run = (user) => { const r = rows(); const a = allow(user); const refused = applyContactImportActionGates(r, a.creates, a.updates); return { r, refused } }

// Full: untouched.
{
  const { r, refused } = run(role({ contacts: true }))
  assert.equal(refused, 0)
  assert.deepEqual(r.map((x) => x.action), ['create', 'update', 'skip', 'error'])
}
// Add off: creates are skipped with the add code, updates still apply.
{
  const { r, refused } = run(role({ contacts: true, 'contacts:add': false }))
  assert.equal(refused, 1)
  assert.deepEqual(r.map((x) => x.action), ['skip', 'update', 'skip', 'error'])
  assert.equal(r[0].code, CONTACT_IMPORT_ADD_DENIED_CODE)
  assert.match(r[0].message, /cannot add contacts/)
  assert.equal(r[1].code, undefined)
}
// Edit off: updates are skipped with the edit code, creates still apply.
{
  const { r, refused } = run(role({ contacts: true, 'contacts:edit': false }))
  assert.equal(refused, 1)
  assert.deepEqual(r.map((x) => x.action), ['create', 'skip', 'skip', 'error'])
  assert.equal(r[1].code, CONTACT_IMPORT_EDIT_DENIED_CODE)
  assert.equal(r[0].code, undefined)
}
// Both off: every write row is refused (the route and the apply authority also refuse the whole job).
{
  const { r, refused } = run(role({ contacts: true, 'contacts:add': false, 'contacts:edit': false }))
  assert.equal(refused, 2)
  assert.deepEqual(r.map((x) => x.action), ['skip', 'skip', 'skip', 'error'])
  assert.equal(r[3].message, 'bad', 'an error row keeps its own message')
}
console.log('PASS contact import: a create needs Add, an update needs Edit, judged per row')

// Wiring: the authority computes both flags from the same getActionTier the contact routes read, a role with neither is
// refused, and the chunk applies the gate for contact types only, before anything is written.
assert.match(engine, /const allowContactCreates = section !== 'contacts' \|\| getActionTier\(actor, 'contacts', 'add'\) !== 'none'/)
assert.match(engine, /const allowContactUpdates = section !== 'contacts' \|\| getActionTier\(actor, 'contacts', 'edit'\) !== 'none'/)
assert.match(engine, /if \(!allowContactCreates && !allowContactUpdates\) \{\s*throw new ImportApplyAuthorizationError\('contacts:add'/)
assert.match(engine, /if \(\['customers', 'suppliers', 'delivery_contacts'\]\.includes\(job\.type\)\) \{\s*applyContactImportActionGates\(results, authority\.allowContactCreates, authority\.allowContactUpdates\)\s*\}/)
const gateAt = engine.indexOf('applyContactImportActionGates(results, authority')
assert.ok(gateAt > engine.indexOf('classifyRows(db, job.type, windowRows'), 'the gate runs on the classified rows')
assert.ok(gateAt < engine.indexOf('const productImportMode = job.type'), 'the gate runs before any row is composed into a write')
assert.match(routes, /overrideSection === 'contacts' && isActionBlocked\(user, 'contacts', 'add'\) && isActionBlocked\(user, 'contacts', 'edit'\)/, 'the route refuses a role that can neither add nor edit')
console.log('PASS contact import: authority flags, whole-job refusal for neither, and the per-chunk gate are wired')

// Both language packs carry the row sentences and the frontend restates the codes.
const en = JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', 'en.json'), 'utf8'))
const km = JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', 'km.json'), 'utf8'))
const rowText = fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'components', 'imports', 'importRowText.ts'), 'utf8')
for (const code of [CONTACT_IMPORT_ADD_DENIED_CODE, CONTACT_IMPORT_EDIT_DENIED_CODE]) {
  assert.ok(typeof en[code] === 'string' && /[ក-៿]/.test(km[code] || ''), `${code} is in both packs, Khmer in km`)
  assert.match(rowText, new RegExp(`${code}: \\[\\{ key: '${code}', params: \\[\\] \\}\\]`), `${code} is restated by the review`)
}
assert.equal(en[CONTACT_IMPORT_ADD_DENIED_CODE], 'Skipped: your role cannot add contacts.', 'pack English equals the Worker message')
console.log('PASS contact import row codes exist in both packs and the review')
