'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')

const BACKEND_DIR = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(BACKEND_DIR, 'server.js')

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

async function login(baseUrl) {
  const { response, json } = await fetchJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'admin',
      password: 'admin',
      organization: null,
      sessionDuration: 'session',
      clientTime: new Date().toISOString(),
      deviceTz: 'UTC',
      deviceName: 'Role QA',
    }),
  })
  assert.equal(response.ok, true, 'Expected admin login to succeed')
  return json.authToken
}

async function main() {
  const runtimeDir = makeTempRoot('bos-default-roles-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const adminToken = await login(server.baseUrl)
    const { response, json } = await fetchJson(server.baseUrl, '/api/roles', {
      authToken: adminToken,
    })
    assert.equal(response.ok, true)
    const roles = json
    const admin = roles.find((role) => role.code === 'admin')
    const manager = roles.find((role) => role.code === 'manager')
    const employee = roles.find((role) => role.code === 'employee')
    assert.ok(admin, 'Admin role should exist')
    assert.ok(manager, 'Manager role should exist')
    assert.ok(employee, 'Employee role should exist')
    assert.equal(Number(admin.is_system || 0), 1)
    assert.equal(Number(manager.is_system || 0), 0, 'Manager defaults must be editable')
    assert.equal(Number(employee.is_system || 0), 0, 'Employee defaults must be editable')
    const managerPermissions = JSON.parse(manager.permissions || '{}')
    const employeePermissions = JSON.parse(employee.permissions || '{}')
    assert.equal(managerPermissions.products, true)
    assert.equal(managerPermissions.inventory, true)
    assert.equal(managerPermissions.backup, undefined)
    assert.equal(managerPermissions.settings, undefined)
    assert.equal(employeePermissions.pos, true)
    assert.equal(employeePermissions.products, true)
    assert.equal(employeePermissions.backup, undefined)
    assert.equal(employeePermissions.settings, undefined)
  } finally {
    await stopServer(server?.child)
  }
}

main().then(() => {
  console.log('PASS default roles are secure and editable')
}).catch((error) => {
  console.error('FAIL default roles are secure and editable')
  console.error(error)
  process.exitCode = 1
})
