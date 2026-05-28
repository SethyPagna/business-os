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
const previousRemoteProvider = process.env.BUSINESS_OS_REMOTE_PROVIDER

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

runTest('Cloudflare mode treats legacy Tailscale identity headers as normal remote access', () => {
  process.env.SYNC_TOKEN = 'secret-token'
  process.env.BUSINESS_OS_REMOTE_PROVIDER = 'cloudflare'
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
  assert.equal(result.access.mode, 'remote')
  assert.equal(result.access.trustedTailscale, false)
  assert.equal(result.access.remoteAccessProvider, 'cloudflare')
})

runTest('legacy Tailscale provider can still trust private Serve identity explicitly', () => {
  process.env.SYNC_TOKEN = 'secret-token'
  process.env.BUSINESS_OS_REMOTE_PROVIDER = 'tailscale'
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
  assert.equal(result.access.remoteAccessProvider, 'tailscale')
})

runTest('Cloudflare public remote access defers to signed user sessions', () => {
  process.env.SYNC_TOKEN = ''
  process.env.BUSINESS_OS_REMOTE_PROVIDER = 'cloudflare'
  const result = authorizeProtectedRequest(makeReq({
    originalUrl: '/api/auth/login',
    host: 'leangcosmetics.dpdns.org',
    remoteAddress: '127.0.0.1',
  }))
  assert.equal(result.allowed, true)
  assert.equal(result.code, 'session_required')
  assert.equal(result.access.mode, 'remote')
})

runTest('public remote access ignores legacy sync token headers', () => {
  process.env.SYNC_TOKEN = 'secret-token'
  process.env.BUSINESS_OS_REMOTE_PROVIDER = 'cloudflare'
  const result = authorizeProtectedRequest(makeReq({
    originalUrl: '/api/auth/login',
    host: 'leangcosmetics.dpdns.org',
    remoteAddress: '127.0.0.1',
    headers: {
      'x-sync-token': 'secret-token',
    },
  }))
  assert.equal(result.allowed, true)
  assert.equal(result.access.mode, 'remote')
  assert.equal(result.code, 'session_required')
})

process.env.SYNC_TOKEN = previousSyncToken
process.env.BUSINESS_OS_REMOTE_PROVIDER = previousRemoteProvider

if (failed > 0) {
  process.exitCode = 1
}
