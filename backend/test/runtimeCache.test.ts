'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'business-os-runtime-cache-'))
process.env.BUSINESS_OS_RUNTIME_DIR = tempRoot
process.env.BUSINESS_OS_REQUIRE_SCALE_SERVICES = '0'
process.env.RUNTIME_CACHE_ENABLED = '0'
process.env.CACHE_REDIS_URL = 'redis://127.0.0.1:6399'
process.env._BOS_CONFIG_LOGGED = '1'

const {
  getJson,
  getRuntimeCacheStatus,
  invalidateForChannel,
  setJson,
} = require('../src/runtimeCache')

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

async function main() {
  await runTest('runtime cache is a safe no-op when disabled', async () => {
    const status = getRuntimeCacheStatus()
    assert.equal(status.enabled, false)
    assert.equal(await getJson('portal:config'), null)
    assert.equal(await setJson('portal:config', { ok: true }, 5), false)
    assert.deepEqual(await invalidateForChannel('products'), {
      prefixes: ['portal:', 'products:', 'inventory:', 'dashboard:'],
      removed: 0,
    })
  })

  await runTest('runtime cache invalidation scans prefixes in order', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/runtimeCache.js'), 'utf8')
    assert.match(source, /async function deletePrefixesInOrder\(prefixes\)/)
    assert.match(source, /for \(const prefix of prefixes\)/)
    assert.match(source, /removed: await deletePrefixesInOrder\(prefixes\)/)
    assert.doesNotMatch(source, /Promise\.all\(prefixes\.map\(\(prefix\) => deleteByPrefix\(prefix\)\)\)/)
  })
}

main().catch((error) => {
  failed += 1
  console.error(error)
})

process.on('beforeExit', () => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch (_) {}
  if (failed > 0) process.exitCode = 1
})
