'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const { call, validateLoopbackBase } = require('./verify-f46-finalizer-native.cjs')

function rejectsBase(value) {
  assert.throws(() => validateLoopbackBase(value), /loopback HTTP origin/)
}

async function main() {
  assert.equal(validateLoopbackBase('http://localhost:8787'), 'http://localhost:8787')
  assert.equal(validateLoopbackBase('http://127.0.0.1:8869/'), 'http://127.0.0.1:8869')
  assert.equal(validateLoopbackBase('http://[::1]:8870'), 'http://[::1]:8870')

  for (const value of [
    '',
    'https://localhost:8787',
    'file:///tmp/f46',
    'http://user@127.0.0.1:8787',
    'http://:pass@127.0.0.1:8787',
    'http://user:pass@127.0.0.1:8787',
    'http://example.test:8787',
    'http://localhost.evil.test:8787',
    'http://127.0.0.1:8787/f46',
    'http://127.0.0.1:8787/?target=elsewhere',
  ]) rejectsBase(value)

  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    response.writeHead(302, { location: 'http://example.test/redirected' })
    response.end()
  })
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()))
  try {
    const { port } = server.address()
    await assert.rejects(
      () => call(validateLoopbackBase(`http://127.0.0.1:${port}`), 'test-cookie', '/redirect', { ok: true }),
      /fetch failed|redirect/i,
    )
    assert.equal(requests, 1, 'redirect response must not be followed')
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }

  console.log('test-f46-finalizer-native-guard: passed')
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
