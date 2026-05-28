'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')
const bcrypt = require('bcryptjs')
const { db } = require('../src/database')

const BACKEND_DIR = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(BACKEND_DIR, 'server.js')
const DEFAULT_TEST_DATABASE_URL = 'postgres://business_os:business_os_dev_password@127.0.0.1:55432/business_os'

let failed = 0
const tests = []

function runTest(name, fn) {
  tests.push({ name, fn })
}

async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}`)
      console.error(error)
    }
  }
  if (failed > 0) process.exitCode = 1
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
  const childOutput = []
  const captureOutput = (chunk) => {
    const text = String(chunk || '')
    if (!text) return
    childOutput.push(text)
    while (childOutput.join('').length > 12000) childOutput.shift()
  }
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      BUSINESS_OS_RUNTIME_DIR: runtimeDir,
      DATABASE_URL: process.env.DATABASE_URL || process.env.BUSINESS_OS_TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL,
      SYNC_TOKEN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', captureOutput)
  child.stderr.on('data', captureOutput)

  const baseUrl = `http://127.0.0.1:${port}`
  await waitForHealth(baseUrl)
  return { child, baseUrl, getOutput: () => childOutput.join('').trim() }
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
  if (options.authCookie) headers.cookie = options.authCookie
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers })
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed: ${response.status}`)
  }
  return json
}

function getDefaultOrganizationIds() {
  const organization = db.prepare(`
    SELECT id
    FROM organizations
    WHERE is_active = 1
    ORDER BY id ASC
    LIMIT 1
  `).get()
  const organizationId = Number(organization?.id || 0) || null
  const group = organizationId
    ? db.prepare(`
        SELECT id
        FROM organization_groups
        WHERE organization_id = ?
        ORDER BY is_default DESC, id ASC
        LIMIT 1
      `).get(organizationId)
    : null
  return {
    organizationId,
    organizationGroupId: Number(group?.id || 0) || null,
  }
}

function cleanupTestUser(username) {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (!user?.id) return
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id)
  db.prepare('DELETE FROM verification_codes WHERE user_id = ?').run(user.id)
  db.prepare('DELETE FROM audit_logs WHERE user_id = ? OR entity_id = ? OR record_id = ?').run(user.id, String(user.id), String(user.id))
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
}

function createTestUser(username, password) {
  cleanupTestUser(username)
  const role = db.prepare(`
    SELECT id
    FROM roles
    WHERE code = 'employee'
    ORDER BY id ASC
    LIMIT 1
  `).get()
  const { organizationId, organizationGroupId } = getDefaultOrganizationIds()
  const passwordHash = bcrypt.hashSync(password, 10)
  db.prepare(`
    INSERT INTO users (
      username, name, password, role_id, permissions, is_active,
      organization_id, organization_group_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '{}', 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(username, `Auth Security ${username}`, passwordHash, role?.id || null, organizationId, organizationGroupId)
}

function extractSessionCookie(response) {
  const setCookie = response.headers.get('set-cookie') || ''
  const cookie = setCookie.split(';')[0]
  assert.match(cookie, /^bos_session=/, 'Expected bos_session cookie')
  return cookie
}

async function login(baseUrl, username, password, organization = null) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
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
  const text = await response.text()
  const json = text ? JSON.parse(text) : {}
  if (!response.ok || json?.success === false) {
    throw new Error(json?.error || `Request failed: ${response.status}`)
  }
  return { ...json, authCookie: extractSessionCookie(response) }
}

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

runTest('changing a password revokes the previous session token', async () => {
  const runtimeDir = makeTempRoot('bos-auth-session-revoke-')
  const username = `bos_auth_security_${Date.now()}`
  const initialPassword = 'AuthSecurity123!'
  const changedPassword = 'AuthSecurity456!'
  let server = null
  try {
    createTestUser(username, initialPassword)
    server = await startServer(runtimeDir)
    const loginResult = await login(server.baseUrl, username, initialPassword)
    const oldCookie = loginResult.authCookie
    assert.ok(oldCookie, 'Expected login cookie')

    const bootstrap = await fetchJson(server.baseUrl, '/api/auth/bootstrap', { authCookie: oldCookie })
    const userId = Number(bootstrap?.user?.id || 0)
    assert.ok(userId > 0, 'Expected bootstrap user id')

    await fetchJson(server.baseUrl, `/api/users/${userId}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authCookie: oldCookie,
      body: JSON.stringify({
        currentPassword: initialPassword,
        newPassword: changedPassword,
      }),
    })

    const staleResponse = await fetch(`${server.baseUrl}/api/auth/bootstrap`, {
      headers: {
        cookie: oldCookie,
      },
    })
    const staleJson = JSON.parse(await staleResponse.text())
    assert.equal(staleResponse.status, 401)
    assert.equal(staleJson.code, 'invalid_session')

    const newLogin = await login(server.baseUrl, username, changedPassword)
    const newCookie = newLogin.authCookie
    assert.ok(newCookie, 'Expected new login cookie')

    await fetchJson(server.baseUrl, `/api/users/${userId}/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      authCookie: newCookie,
      body: JSON.stringify({
        currentPassword: changedPassword,
        newPassword: initialPassword,
      }),
    })
  } finally {
    await stopServer(server?.child)
    cleanupTestUser(username)
  }
})

runTests().catch((error) => {
  failed += 1
  console.error(error)
  process.exitCode = 1
})
