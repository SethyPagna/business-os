const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

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
