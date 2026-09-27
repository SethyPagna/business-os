// R2 APAC move (27 Sep 2026): sweepImageAudit keeps an R2 list cursor in KV
// and clears it only on success. After the ASSETS binding moves to another
// bucket, the stored cursor was issued by the old bucket; if list() refuses
// it, the old code threw on every tick forever. The sweep must drop a refused
// cursor and restart from the top of uploads/, and must still surface an
// error that happens without a cursor.
//
// Discriminating: against the pre-fix code, check 1 throws (the cursor is
// never cleared) -- this file goes red.
//
// Run (from cloudflare/): node scripts/test-image-audit-cursor-reset-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const CURSOR_KEY = 'system-cursor:image-audit-sweep'

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

function makeEnv(db, { cursor, listFailsWithoutCursor = false }) {
  const kv = new Map()
  if (cursor) kv.set(CURSOR_KEY, cursor)
  const listCalls = []
  const env = {
    CACHE: {
      get: async (key) => (kv.has(key) ? kv.get(key) : null),
      put: async (key, value) => { kv.set(key, value) },
      delete: async (key) => { kv.delete(key) },
    },
    ASSETS: {
      list: async (options) => {
        listCalls.push({ ...options })
        // The new bucket refuses a cursor it did not issue.
        if (options.cursor) throw new Error('invalid cursor')
        if (listFailsWithoutCursor) throw new Error('bucket unavailable')
        return { objects: [{ key: 'uploads/a.jpg', size: 1000 }], truncated: false }
      },
    },
  }
  const audit = loadReal('lib/imageAudit.ts', {
    './db': { getDb: () => db },
    './imagePipeline': { IMAGE_MAX_BYTES: 900 * 1024, needsOptimization: (n) => n > 900 * 1024, optimizeImage: async () => ({ ok: false }) },
    './analytics': { recordAnalytics: () => {} },
    './quotaGuard': { consumeQuota: async () => {} },
  })
  return { env, audit, kv, listCalls }
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

async function run() {
  const db = openDb(loadAll())

  await check('a cursor the bucket refuses is dropped and the sweep restarts from the top', async () => {
    const { env, audit, kv, listCalls } = makeEnv(db, { cursor: 'old-bucket-cursor' })
    const result = await audit.sweepImageAudit(env)
    assert.equal(result.examined, 1)
    assert.equal(kv.has(CURSOR_KEY), false, 'the refused cursor must be cleared')
    assert.equal(listCalls.length, 2)
    assert.equal(listCalls[1].cursor, undefined, 'the retry must list without a cursor')
    const row = await db.prepare(`SELECT status FROM image_audit WHERE key = 'uploads/a.jpg'`).get()
    assert.equal(row.status, 'ok')
  })

  await check('an error without a stored cursor still propagates (no silent swallow)', async () => {
    const { env, audit, listCalls } = makeEnv(db, { listFailsWithoutCursor: true })
    await assert.rejects(() => audit.sweepImageAudit(env), /bucket unavailable/)
    assert.equal(listCalls.length, 1, 'no blind retry when there was no cursor to blame')
  })

  console.log(`\n${passed} checks passed`)
}

run().catch((error) => { console.error(error); process.exit(1) })
