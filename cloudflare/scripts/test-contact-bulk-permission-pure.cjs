const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-bulk-permission-'))
const permissionSource = read('src/lib/permissions.ts')
const permissionTs = path.join(temp, 'permissions.ts')
fs.writeFileSync(permissionTs, permissionSource)
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--module', 'commonjs', '--target', 'es2020', '--outDir', temp, permissionTs], { stdio: 'inherit' })
const { getActionTier } = require(path.join(temp, 'permissions.js'))

const narrowed = {
  role_code: 'custom',
  role_permissions: JSON.stringify({ contacts: true }),
  permissions: JSON.stringify({ 'contacts:bulk': false }),
}
assert.equal(getActionTier(narrowed, 'contacts', 'bulk'), 'none')
assert.equal(getActionTier(narrowed, 'contacts', 'delete'), 'full')
assert.equal(getActionTier(narrowed, 'contacts', 'merge'), 'full')
console.log('PASS contacts.bulk narrows multi-row authority without removing individual actions')

const contacts = read('src/routes/contacts.ts')
const mergeStart = contacts.indexOf('app.post(`${config.path}/merge`')
const mergeBody = contacts.indexOf('const body =', mergeStart)
const mergeGate = contacts.slice(mergeStart, mergeBody)
assert.match(mergeGate, /getActionTier\(user, 'contacts', 'merge'\) === 'none'/)
assert.match(mergeGate, /getActionTier\(user, 'contacts', 'bulk'\) === 'none'/)

const bulkStart = contacts.indexOf('app.post(`${config.path}/bulk-delete-jobs`')
const bulkBody = contacts.indexOf('const body =', bulkStart)
const bulkGate = contacts.slice(bulkStart, bulkBody)
assert.match(bulkGate, /getActionTier\(user, 'contacts', 'bulk_delete'\) === 'none'/)
assert.match(bulkGate, /getActionTier\(user, 'contacts', 'bulk'\) === 'none'/)

const deleteStart = contacts.indexOf('app.delete(`${config.path}/:id`')
const deleteEnd = contacts.indexOf('app.post(`${config.path}/bulk-delete-jobs`', deleteStart)
assert.doesNotMatch(contacts.slice(deleteStart, deleteEnd), /getActionTier\(user, 'contacts', 'bulk'\)/)
console.log('PASS contact merge and server bulk delete require contacts.bulk before request data is acted on')

const statusStart = contacts.indexOf('app.get(`${config.path}/bulk-delete-jobs/:id`')
const cancelStart = contacts.indexOf('app.post(`${config.path}/bulk-delete-jobs/:id/cancel`')
const cancelEnd = contacts.indexOf('\n  // NOTE:', cancelStart)
const statusRoute = contacts.slice(statusStart, cancelStart)
const cancelRoute = contacts.slice(cancelStart, cancelEnd)
assert.match(statusRoute, /job\.entity_type !== contactBulkDeleteEntityType\(config\)/)
assert.match(cancelRoute, /getActionTier\(user, 'contacts', 'bulk'\) !== 'full'/)
assert.ok(cancelRoute.indexOf("getActionTier(user, 'contacts', 'bulk')") < cancelRoute.indexOf('getBulkDeleteJob('))
assert.match(cancelRoute, /job\.entity_type !== entityType/)
assert.match(cancelRoute, /WHERE id = @id AND entity_type = @entityType/)

function load(file, dependencies = {}) {
  const filename = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', output)(name => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('.')) return {}
    return require(name)
  }, module.exports, module)
  return module.exports
}

const jobs = new Map([
  ['customer-job', { id: 'customer-job', entity_type: 'customers', status: 'pending' }],
  ['supplier-job', { id: 'supplier-job', entity_type: 'suppliers', status: 'pending' }],
])
const mutations = []
const fakeDb = {
  prepare(sql) {
    return {
      async run(bindings) {
        mutations.push({ sql, bindings })
        const job = jobs.get(bindings.id)
        if (job && job.entity_type === bindings.entityType && ['pending', 'processing'].includes(job.status)) job.cancel_requested = 1
        return { meta: { changes: job?.cancel_requested ? 1 : 0 } }
      },
    }
  },
}
let actor = narrowed
const contactsApp = load('routes/contacts.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() } },
  '../lib/db': { getDb: () => fakeDb },
  '../lib/permissions': { ...require(path.join(temp, 'permissions.js')) },
  '../lib/bulkDeleteEngine': {
    getBulkDeleteJob: async (_env, id) => jobs.get(id) ?? null,
    reapStalledBulkDeleteJobs: async () => {},
  },
}).default

async function cancel(pathname) {
  const response = await contactsApp.request(pathname, { method: 'POST' }, {})
  return { status: response.status, body: await response.json() }
}

async function verifyCancelRoute() {
  mutations.length = 0
  actor = { role_code: 'employee', role_permissions: JSON.stringify({ contacts: 'review' }), permissions: '{}' }
  assert.equal((await cancel('/customers/bulk-delete-jobs/customer-job/cancel')).status, 403)
  actor = narrowed
  assert.equal((await cancel('/customers/bulk-delete-jobs/customer-job/cancel')).status, 403)
  assert.equal(mutations.length, 0, 'review and explicit contacts:bulk denies must not write D1')

  actor = { role_code: 'custom', role_permissions: JSON.stringify({ contacts: true }), permissions: '{}' }
  assert.equal((await cancel('/customers/bulk-delete-jobs/supplier-job/cancel')).status, 404)
  assert.equal(mutations.length, 0, 'a Customers route must not cancel a Suppliers job')
  assert.equal((await cancel('/customers/bulk-delete-jobs/customer-job/cancel')).status, 200)
  assert.equal(mutations.length, 1)
  assert.equal(mutations[0].bindings.entityType, 'customers')
  assert.equal(jobs.get('customer-job').cancel_requested, 1)
  console.log('PASS real cancel route denies review and explicit bulk blocks before D1, binds entity type, and preserves authorized cancellation')
}

const importJobs = read('src/routes/importJobs.ts')
const permissionStart = importJobs.indexOf('async function requireImportPermission')
const permissionEnd = importJobs.indexOf('\nfunction requireProductImageAction', permissionStart)
const importGate = importJobs.slice(permissionStart, permissionEnd)
assert.match(importGate, /overrideSection === 'contacts' && isActionBlocked\(user, 'contacts', 'bulk'\)/)
assert.ok(importGate.indexOf("isActionBlocked(user, 'contacts', 'bulk')") < importGate.indexOf("isActionBlocked(user, overrideSection, 'import')"))

const importEngine = read('src/lib/importEngine.ts')
const applyStart = importEngine.indexOf('export async function assertCurrentImportApplyAuthority')
const applyEnd = importEngine.indexOf('\n// Human-readable label', applyStart)
const applyGate = importEngine.slice(applyStart, applyEnd)
assert.match(applyGate, /section === 'contacts' && isActionBlocked\(actor, 'contacts', 'bulk'\)/)
assert.match(applyGate, /ImportApplyAuthorizationError\('contacts:bulk'/)
console.log('PASS contact import request and asynchronous apply both recheck contacts.bulk')

verifyCancelRoute().catch(error => {
  console.error(error)
  process.exitCode = 1
})
