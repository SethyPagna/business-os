'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')

const BACKEND_DIR = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(BACKEND_DIR, 'server.js')

let failed = 0
const pendingTests = new Set()

function runTest(name, fn) {
  pendingTests.add(name)
  Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`PASS ${name}`)
    })
    .catch((error) => {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    })
    .finally(() => {
      pendingTests.delete(name)
      if (pendingTests.size === 0 && failed > 0) {
        process.exitCode = 1
      }
    })
}

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = server.address()?.port
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
    server.on('error', reject)
  })
}

async function waitForHealth(baseUrl, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`)
      if (response.ok) return
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Server did not become healthy at ${baseUrl}`)
}

async function startServer(runtimeDir) {
  const port = await getFreePort()
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      BUSINESS_OS_RUNTIME_DIR: runtimeDir,
      SYNC_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHealth(baseUrl)
  return { child, baseUrl }
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
  if (exited) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.authToken) headers['x-auth-session'] = options.authToken
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  return { response, json }
}

async function login(baseUrl, username = 'admin', password = 'admin') {
  const { response, json } = await fetchJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      organization: null,
      sessionDuration: 'session',
      clientTime: new Date().toISOString(),
      deviceTz: 'UTC',
      deviceName: 'QA Browser',
    }),
  })
  assert.equal(response.ok, true, `Expected ${username} login to succeed`)
  assert.ok(json.authToken, 'Expected auth token')
  return json.authToken
}

async function createLimitedUser(baseUrl, adminToken) {
  const username = `limited_${Date.now()}`
  const password = 'limited-pass'
  const { response, json } = await fetchJson(baseUrl, '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    authToken: adminToken,
    body: JSON.stringify({
      username,
      name: 'Limited User',
      password,
      permissions: {},
      is_active: 1,
    }),
  })
  assert.equal(response.ok, true, json.error || 'Expected limited user creation to succeed')
  return { username, password }
}

runTest('sensitive system routes require backup or settings permission', async () => {
  const runtimeDir = makeTempRoot('bos-system-route-security-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const adminToken = await login(server.baseUrl)
    const limited = await createLimitedUser(server.baseUrl, adminToken)
    const limitedToken = await login(server.baseUrl, limited.username, limited.password)

    const guardedRequests = [
      ['GET', '/api/system/drive-sync/status'],
      ['POST', '/api/system/drive-sync/sync-now'],
      ['POST', '/api/system/backup/export-folder'],
      ['GET', '/api/system/data-path'],
      ['DELETE', '/api/system/data-path'],
      ['GET', '/api/system/scale-migration/status'],
      ['POST', '/api/system/scale-migration/prepare'],
      ['POST', '/api/system/scale-migration/run'],
    ]

    for (const [method, pathname] of guardedRequests) {
      const { response, json } = await fetchJson(server.baseUrl, pathname, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        authToken: limitedToken,
        body: method === 'POST' ? JSON.stringify({ destinationDir: runtimeDir }) : undefined,
      })
      assert.equal(response.status, 403, `${method} ${pathname} should be permission-guarded`)
      assert.equal(json.code, 'forbidden')
    }

    const status = await fetchJson(server.baseUrl, '/api/system/scale-migration/status', {
      authToken: adminToken,
    })
    assert.equal(status.response.ok, true)
    assert.equal(status.json.item.mode, 'sqlite_authoritative')
    assert.equal(status.json.item.target.databaseDriver, 'sqlite')
    assert.equal(status.json.item.backupRequired, true)

    const prepare = await fetchJson(server.baseUrl, '/api/system/scale-migration/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: adminToken,
      body: JSON.stringify({}),
    })
    assert.equal(prepare.response.ok, true)
    assert.equal(prepare.json.item.mode, 'sqlite_authoritative')
    assert.equal(prepare.json.item.requiresFreshBackup, false)
    assert.equal(prepare.json.item.safety.noDataMoved, true)
    assert.equal(prepare.json.item.automation.localBackup.exists, true)
    assert.equal(prepare.json.item.automation.driveSync.status, 'skipped')

    const runWithoutConfirmation = await fetchJson(server.baseUrl, '/api/system/scale-migration/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: adminToken,
      body: JSON.stringify({}),
    })
    assert.equal(runWithoutConfirmation.response.status, 400)

    const runLocked = await fetchJson(server.baseUrl, '/api/system/scale-migration/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: adminToken,
      body: JSON.stringify({ confirmation: 'MIGRATE' }),
    })
    assert.equal(runLocked.response.status, 409)
  } finally {
    await stopServer(server?.child)
  }
})

runTest('action history is isolated to owner unless user has privileged access', async () => {
  const runtimeDir = makeTempRoot('bos-action-history-security-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const adminToken = await login(server.baseUrl)
    const limited = await createLimitedUser(server.baseUrl, adminToken)
    const limitedToken = await login(server.baseUrl, limited.username, limited.password)

    const created = await fetchJson(server.baseUrl, '/api/action-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: adminToken,
      body: JSON.stringify({
        scope: 'profile',
        entity: 'user',
        label: 'Admin-only action',
      }),
    })
    assert.equal(created.response.ok, true)
    assert.ok(created.json.id)

    const limitedList = await fetchJson(server.baseUrl, '/api/action-history?scope=profile&limit=10', {
      authToken: limitedToken,
    })
    assert.equal(limitedList.response.ok, true)
    assert.deepEqual(limitedList.json.items, [])

    const forbiddenPatch = await fetchJson(server.baseUrl, `/api/action-history/${created.json.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      authToken: limitedToken,
      body: JSON.stringify({ status: 'redoable' }),
    })
    assert.equal(forbiddenPatch.response.status, 404)

    const ownCreated = await fetchJson(server.baseUrl, '/api/action-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: limitedToken,
      body: JSON.stringify({
        scope: 'profile',
        entity: 'user',
        label: 'Limited user action',
      }),
    })
    assert.equal(ownCreated.response.ok, true)

    const ownList = await fetchJson(server.baseUrl, '/api/action-history?scope=profile&limit=10', {
      authToken: limitedToken,
    })
    assert.equal(ownList.response.ok, true)
    assert.equal(ownList.json.items.length, 1)
    assert.equal(ownList.json.items[0].label, 'Limited user action')

    const adminDefaultList = await fetchJson(server.baseUrl, '/api/action-history?scope=profile&limit=10', {
      authToken: adminToken,
    })
    assert.equal(adminDefaultList.response.ok, true)
    assert.equal(adminDefaultList.json.items.length, 1)
    assert.equal(adminDefaultList.json.items[0].label, 'Admin-only action')

    const adminAuditList = await fetchJson(server.baseUrl, '/api/action-history?scope=profile&limit=10&all=1', {
      authToken: adminToken,
    })
    assert.equal(adminAuditList.response.ok, true)
    assert.equal(adminAuditList.json.items.length, 2)
  } finally {
    await stopServer(server?.child)
  }
})
