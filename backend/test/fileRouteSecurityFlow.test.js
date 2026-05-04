'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawn, spawnSync } = require('child_process')

const BACKEND_DIR = path.resolve(__dirname, '..')
const SERVER_ENTRY = path.join(BACKEND_DIR, 'server.js')
const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pR6tWQAAAAASUVORK5CYII='

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
  if (options.authCookie || options.authToken) headers.cookie = options.authCookie || options.authToken
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
      deviceName: 'QA Browser',
    }),
  })
  assert.equal(response.ok, true, 'Expected default admin login to succeed')
  assert.equal(json?.authMode, 'cookie', 'Expected cookie auth mode')
  const cookie = (response.headers.get('set-cookie') || '').split(';')[0]
  assert.match(cookie, /^bos_session=/, 'Expected bos_session cookie')
  return cookie
}

function buildForm(fieldName, buffer, fileName, mimeType) {
  const form = new FormData()
  form.set(fieldName, new Blob([buffer], { type: mimeType }), fileName)
  return form
}

pendingTests.add('file upload rejects mismatched content without creating assets')
runTest('file upload rejects mismatched content without creating assets', async () => {
  const runtimeDir = makeTempRoot('bos-upload-mismatch-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await login(server.baseUrl)
    const badForm = buildForm('file', Buffer.from('%PDF-1.7', 'ascii'), 'photo.png', 'image/png')

    const rejected = await fetchJson(server.baseUrl, '/api/files/upload', {
      method: 'POST',
      authToken,
      body: badForm,
    })
    assert.equal(rejected.response.status, 400)
    assert.match(String(rejected.json.error || ''), /do not match the selected file type/i)

    const listed = await fetchJson(server.baseUrl, '/api/files', {
      authToken,
    })
    assert.equal(listed.response.ok, true)
    assert.equal(Array.isArray(listed.json.items), true)
    assert.equal(listed.json.items.length, 0)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('successful file upload preserves a sanitized readable public filename')
runTest('successful file upload preserves a sanitized readable public filename', async () => {
  const runtimeDir = makeTempRoot('bos-upload-opaque-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await login(server.baseUrl)
    const fileName = 'sensitive-client-logo.png'
    const goodForm = buildForm('file', Buffer.from(TINY_PNG_BASE64, 'base64'), fileName, 'image/png')

    const uploaded = await fetchJson(server.baseUrl, '/api/files/upload', {
      method: 'POST',
      authToken,
      body: goodForm,
    })
    assert.equal(uploaded.response.ok, true)
    assert.equal(uploaded.json.original_name, fileName)
    assert.match(String(uploaded.json.public_path || ''), /^\/uploads\/sensitive-client-logo(?:-\d+)?\.png$/i)
    assert.equal(String(uploaded.json.public_path || '').includes('..'), false)
  } finally {
    await stopServer(server?.child)
  }
})

pendingTests.add('file list rejects invalid filters and delete rejects invalid ids')
runTest('file list rejects invalid filters and delete rejects invalid ids', async () => {
  const runtimeDir = makeTempRoot('bos-upload-filters-')
  let server = null
  try {
    server = await startServer(runtimeDir)
    const authToken = await login(server.baseUrl)

    const badFilter = await fetchJson(server.baseUrl, '/api/files?mediaType=script', {
      authToken,
    })
    assert.equal(badFilter.response.status, 400)
    assert.match(String(badFilter.json.error || ''), /invalid media type filter/i)

    const badSearch = await fetchJson(server.baseUrl, `/api/files?search=${'a'.repeat(121)}`, {
      authToken,
    })
    assert.equal(badSearch.response.status, 400)
    assert.match(String(badSearch.json.error || ''), /120 characters or fewer/i)

    const badDelete = await fetchJson(server.baseUrl, '/api/files/not-a-number', {
      method: 'DELETE',
      authToken,
    })
    assert.equal(badDelete.response.status, 400)
    assert.match(String(badDelete.json.error || ''), /invalid file id/i)
  } finally {
    await stopServer(server?.child)
  }
})
