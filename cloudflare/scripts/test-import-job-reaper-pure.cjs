// Focused execution coverage for the import-job list reaper. The real route
// module is transpiled and mounted; only unrelated Worker dependencies are
// stubbed. Reaper SQL runs against node:sqlite so cutoff and race predicates
// are exercised rather than reimplemented in the test.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { D1Compat } = require('./harness/d1compat.cjs')

const srcRoot = path.join(__dirname, '..', 'src')
const routePath = path.join(srcRoot, 'routes', 'importJobs.ts')

function newDb() {
  const raw = new DatabaseSync(':memory:')
  raw.exec(`
    CREATE TABLE import_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT,
      last_error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      policy_json TEXT DEFAULT '{}',
      summary_json TEXT DEFAULT '{}'
    )
  `)
  return new D1Compat(raw)
}

function insertJob(db, { id, type = 'products', status, updatedAt }) {
  db.prepare(`
    INSERT INTO import_jobs (id, type, status, phase, updated_at)
    VALUES (@id, @type, @status, @status, @updatedAt)
  `).run({ id, type, status, updatedAt })
}

function instrumentDb(db, options = {}) {
  const observations = { probes: 0, writes: [], refreshed: false }
  return {
    observations,
    prepare(sql) {
      const statement = db.prepare(sql)
      return {
        async get(params) {
          observations.probes += 1
          if (options.failProbe) throw new Error('D1 probe unavailable')
          return statement.get(params)
        },
        async run(params) {
          observations.writes.push(sql)
          if (options.refreshBeforeActiveUpdate && !observations.refreshed && /SET status = 'failed'/i.test(sql)) {
            observations.refreshed = true
            db.prepare(`UPDATE import_jobs SET updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({ id: options.refreshBeforeActiveUpdate })
          }
          const result = statement.run(params)
          return { changes: result.meta?.changes ?? 0, lastInsertRowid: Number(result.meta?.last_row_id ?? 0) }
        },
      }
    },
  }
}

let activeDb = instrumentDb(newDb())

const fallback = new Proxy({}, {
  get(target, property) {
    if (!(property in target)) target[property] = () => undefined
    return target[property]
  },
})

const auth = {
  requireAuth: async (c, next) => {
    c.set('user', c.env.TEST_USER)
    await next()
  },
}
const permissions = {
  hasPermission: (user, permission) => Boolean(user?.grants?.[permission]),
  hasAnyPermission: (user, requested) => requested.some((permission) => Boolean(user?.grants?.[permission])),
  isActionBlocked: () => false,
  getActionTier: () => 'full',
}

const source = fs.readFileSync(routePath, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: routePath,
}).outputText
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../lib/db') return { getDb: () => activeDb }
  if (request === '../lib/auth') return auth
  if (request === '../lib/permissions') return permissions
  if (request === '../index') return {}
  if (request.startsWith('../lib/') || request.startsWith('../durable-objects/')) return fallback
  return originalLoad.call(this, request, parent, isMain)
}
let route
try {
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    loaded.exports, require, loaded, routePath, path.dirname(routePath),
  )
  route = loaded.exports
} finally {
  Module._load = originalLoad
}

const { reapStalledImportJobs } = route
const app = route.default
app.onError((error, c) => c.json({ success: false, error: error.message }, 500))

function row(db, id) {
  return db.prepare('SELECT * FROM import_jobs WHERE id = @id').get({ id })
}

function rawListBinding({ rows = [], fail = false, calls }) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async all() {
              calls.push({ sql, values })
              if (fail) throw new Error('authoritative list failed')
              return { results: rows }
            },
          }
        },
      }
    },
  }
}

async function main() {
  {
    const db = newDb()
    insertJob(db, { id: 'fresh', status: 'running', updatedAt: new Date().toISOString() })
    activeDb = instrumentDb(db)
    await reapStalledImportJobs({})
    assert.equal(activeDb.observations.probes, 1)
    assert.equal(activeDb.observations.writes.length, 0, 'idle polling must not issue either UPDATE')
    assert.equal(row(db, 'fresh').status, 'running')
    console.log('PASS idle reaper performs one probe and zero writes')
  }

  {
    const db = newDb()
    insertJob(db, { id: 'active-old', status: 'applying', updatedAt: '2000-01-01 00:00:00' })
    insertJob(db, { id: 'cancel-old', status: 'cancelling', updatedAt: '2000-01-01 00:00:00' })
    activeDb = instrumentDb(db)
    await reapStalledImportJobs({})
    assert.equal(activeDb.observations.writes.length, 2, 'each eligible reap class gets its matching update')
    assert.equal(row(db, 'active-old').status, 'failed')
    assert.match(row(db, 'active-old').last_error, /Stalled: no progress/)
    assert.equal(row(db, 'cancel-old').status, 'cancelled')
    assert.match(row(db, 'cancel-old').last_error, /Cancel never confirmed/)
    console.log('PASS stale active and cancelling jobs remain eligible for their existing recovery states')
  }

  {
    const db = newDb()
    insertJob(db, { id: 'racing', status: 'running', updatedAt: '2000-01-01 00:00:00' })
    activeDb = instrumentDb(db, { refreshBeforeActiveUpdate: 'racing' })
    await reapStalledImportJobs({})
    assert.equal(activeDb.observations.refreshed, true)
    assert.equal(row(db, 'racing').status, 'running', 'the UPDATE cutoff must protect a job refreshed after the probe')
    console.log('PASS a concurrent worker refresh prevents stale-candidate reaping')
  }

  {
    const db = newDb()
    activeDb = instrumentDb(db, { failProbe: true })
    const calls = []
    const listed = [{ id: 'visible', type: 'products', policy_json: '{}', summary_json: '{}' }]
    const env = {
      TEST_USER: { grants: { products: true } },
      DB: rawListBinding({ rows: listed, calls }),
    }
    const response = await app.request('/', {}, env)
    assert.equal(response.status, 200, 'best-effort probe failure must not mask list data')
    assert.deepEqual((await response.json()).jobs.map((job) => job.id), ['visible'])
    assert.equal(activeDb.observations.writes.length, 0)
    assert.deepEqual(calls[0].values, ['products', 50], 'the existing permitted-type and limit bindings remain in force')

    const deniedCalls = []
    const denied = await app.request('/', {}, {
      TEST_USER: { grants: {} },
      DB: rawListBinding({ rows: listed, calls: deniedCalls }),
    })
    assert.equal(denied.status, 403)
    assert.equal(deniedCalls.length, 0, 'permission denial still precedes reaping and list access')
    console.log('PASS list permissions and successful data remain authoritative when housekeeping fails')
  }

  {
    activeDb = instrumentDb(newDb(), { failProbe: true })
    const response = await app.request('/', {}, {
      TEST_USER: { grants: { products: true } },
      DB: rawListBinding({ fail: true, calls: [] }),
    })
    assert.equal(response.status, 500)
    assert.match((await response.json()).error, /authoritative list failed/)
    console.log('PASS a failed list query is reported even when best-effort housekeeping also failed')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
