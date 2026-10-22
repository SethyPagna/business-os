// lib/queueRoles.ts -- the Worker recognises its four queues by their ending,
// because every client names them with its own prefix (QUEUE_PREFIX in
// wrangler.template.toml). A literal queue name in the dispatcher would drop,
// without any error, every message of a client whose prefix is different.
//
// Run: node scripts/test-queue-roles-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))
const { outputText } = ts.transpileModule(fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'queueRoles.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'queueRoles.ts',
})
const mod = { exports: {} }
new Function('module', 'exports', outputText)(mod, mod.exports)
const { queueRole } = mod.exports

let passed = 0
function check(name, fn) {
  try { fn(); passed += 1 } catch (err) { console.error(`FAIL ${name}\n  ${err.message}`); process.exitCode = 1 }
}

check('the four queues of the first deployment keep their roles', () => {
  assert.equal(queueRole('business-os-import'), 'import')
  assert.equal(queueRole('business-os-import-dlq'), 'import-dlq')
  assert.equal(queueRole('business-os-media'), 'media')
  assert.equal(queueRole('business-os-backup-assets'), 'backup-assets')
})

check('any client prefix is served, including one that itself contains a role word', () => {
  for (const prefix of ['bm', 'second-shop', 'a1', 'shop-import', 'media-shop', 'x-backup-assets']) {
    assert.equal(queueRole(`${prefix}-import`), 'import', prefix)
    assert.equal(queueRole(`${prefix}-import-dlq`), 'import-dlq', prefix)
    assert.equal(queueRole(`${prefix}-media`), 'media', prefix)
    assert.equal(queueRole(`${prefix}-backup-assets`), 'backup-assets', prefix)
  }
})

check('the dead-letter queue is never taken for the import queue it belongs to', () => {
  assert.equal(queueRole('shop-import-dlq'), 'import-dlq')
  assert.notEqual(queueRole('shop-import-dlq'), 'import')
})

check('anything else is no queue of ours, and nothing throws', () => {
  for (const name of ['', 'import', '-import', 'media', 'shop-importer', 'shop-media2', 'shop_import', 'shop-import-dlq-2', 'SHOP-IMPORT', undefined, null, 5, {}]) {
    assert.equal(queueRole(name), null, String(name))
  }
})

check('POSITIVE CONTROL: the dispatcher in index.ts goes through queueRole and names no queue', () => {
  const index = fs.readFileSync(path.join(cloudflareRoot, 'src', 'index.ts'), 'utf8')
  assert.match(index, /const role = queueRole\(batch\.queue\)/)
  for (const role of ['import', 'import-dlq', 'media', 'backup-assets']) assert.ok(index.includes(`role === '${role}'`), role)
  assert.ok(!/batch\.queue === '/.test(index), 'a literal queue name would drop another client\'s messages')
})

console.log(`test-queue-roles-pure: ${passed} checks passed`)
