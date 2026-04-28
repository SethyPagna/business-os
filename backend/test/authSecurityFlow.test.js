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
      if (pendingTests.delete(name) && pendingTests.size === 0 && failed > 0) {
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
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed: ${response.status}`)
  }
  return json
}

async function login(baseUrl, username, password, organization = null) {
  return fetchJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password,
      organization,
      sessionDuration: 'session',
      clientTime: new Date().toISOString(),
      deviceTz: 'UTC',
      deviceName: 'QA Browser',
    }),
  })
}

pendingTests.add('login does not enumerate missing organizations')
runTest('login does not enumerate missing organizations', async () => {
  const runtimeDir = makeTempRoot('bos-auth-org-enum-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const response = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: 'admin',
        organization: 'does-not-exist',
        sessionDuration: 'session',
      }),
    })
    const json = JSON.parse(await response.text())
    assert.equal(response.status, 401)
    assert.equal(json.error, 'Invalid username or password')
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('changing a password revokes the previous session token')
runTest('changing a password revokes the previous session token', async () => {
  const runtimeDir = makeTempRoot('bos-auth-session-revoke-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const loginResult = await login(server.baseUrl, 'admin', 'admin')
    const oldToken = loginResult.authToken
    assert.ok(oldToken, 'Expected login token')

    const bootstrap = await fetchJson(server.baseUrl, '/api/auth/bootstrap', { authToken: oldToken })
    const userId = Number(bootstrap?.user?.id || 0)
    assert.ok(userId > 0, 'Expected bootstrap user id')

    await fetchJson(server.baseUrl, `/api/users/${userId}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: oldToken,
      body: JSON.stringify({
        currentPassword: 'admin',
        newPassword: 'admin123',
      }),
    })

    const staleResponse = await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
      headers: {
        'x-auth-session': oldToken,
      },
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 401)
    assert.equal(staleJson.code, 'invalid_session')

    const newLogin = await login(server.baseUrl, 'admin', 'admin123')
    const newToken = newLogin.authToken
    assert.ok(newToken, 'Expected new login token')

    await fetchJson(server.baseUrl, `/api/users/${userId}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authToken: newToken,
      body: JSON.stringify({
        currentPassword: 'admin123',
        newPassword: 'admin',
      }),
    })
  } finally {
    await stopServer(server?.child)
  }
})
