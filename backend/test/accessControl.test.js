'use strict'

const assert = require('node:assert/strict')
const {
  authorizeProtectedRequest,
  isPublicApiRequest,
} = require('../src/accessControl')

let failed = 0

function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function makeReq({ method = 'GET', originalUrl = '/api/auth/login', host = 'localhost:4000', remoteAddress = '127.0.0.1', headers = {} } = {}) {
  return {
    method,
    originalUrl,
    path: originalUrl.split('?')[0],
    headers: {
      host,
      ...headers,
    },
    socket: { remoteAddress },
    connection: { remoteAddress },
  }
}

const previousSyncToken = process.env.SYNC_TOKEN

runTest('public API allowlist keeps customer portal/config endpoints open', () => {
  assert.equal(isPublicApiRequest(makeReq({ originalUrl: '/api/system/config' })), true)
  assert.equal(isPublicApiRequest(makeReq({ originalUrl: '/api/catalog/products' })), true)
  assert.equal(isPublicApiRequest(makeReq({ method: 'POST', originalUrl: '/api/portal/submissions' })), true)
  assert.equal(isPublicApiRequest(makeReq({ originalUrl: '/api/auth/login' })), false)
})

runTest('localhost access does not require sync token', () => {
  process.env.SYNC_TOKEN = 'secret-token'
  const result = authorizeProtectedRequest(makeReq({
    originalUrl: '/api/auth/login',
    host: 'localhost:4000',
    remoteAddress: '127.0.0.1',
  }))
  assert.equal(result.allowed, true)
  assert.equal(result.access.mode, 'local')
})

runTest('private Tailscale Serve identity bypasses sync token', () => {
  process.env.SYNC_TOKEN = 'secret-token'
  const result = authorizeProtectedRequest(makeReq({
    originalUrl: '/api/auth/login',
    host: 'device.example.ts.net',
    remoteAddress: '127.0.0.1',
    headers: {
      'tailscale-user-login': 'user@example.com',
      'tailscale-user-name': 'Tailnet User',
    },
  }))
  assert.equal(result.allowed, true)
  assert.equal(result.access.mode, 'tailscale-private')
})

runTest('public remote access requires a configured sync token', () => {
  process.env.SYNC_TOKEN = ''
  const result = authorizeProtectedRequest(makeReq({
    originalUrl: '/api/auth/login',
    host: 'device.example.ts.net',
    remoteAddress: '127.0.0.1',
  }))
  assert.equal(result.allowed, false)
  assert.equal(result.code, 'public_token_required')
})

runTest('public remote access accepts a valid sync token', () => {
  process.env.SYNC_TOKEN = 'secret-token'
  const result = authorizeProtectedRequest(makeReq({
    originalUrl: '/api/auth/login',
    host: 'device.example.ts.net',
    remoteAddress: '127.0.0.1',
    headers: {
      'x-sync-token': 'secret-token',
    },
  }))
  assert.equal(result.allowed, true)
  assert.equal(result.access.mode, 'tailscale-public')
})

process.env.SYNC_TOKEN = previousSyncToken

if (failed > 0) {
  process.exitCode = 1
}
