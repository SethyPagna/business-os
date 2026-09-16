'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')

function validateLoopbackBase(value) {
  let parsed
  try {
    parsed = new URL(String(value || ''))
  } catch {
    throw new Error('F46_BASE must be a loopback HTTP origin.')
  }

  const host = parsed.hostname.toLowerCase()
  const isLoopback = host === 'localhost'
    || host === '::1'
    || host === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(host)
  if (parsed.protocol !== 'http:'
    || !isLoopback
    || parsed.username
    || parsed.password
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.search
    || parsed.hash) {
    throw new Error('F46_BASE must be a loopback HTTP origin.')
  }

  return parsed.origin
}

async function call(base, sessionCookie, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `bos_session=${sessionCookie}` },
    body: JSON.stringify(body),
    redirect: 'error',
  })
  const json = await response.json()
  assert.equal(response.status, 200, `${path} must return HTTP 200`)
  return json
}

function applyBody(preview) {
  return {
    client_request_id: `f46-native-finalizer-${Date.now()}`,
    manifest_version: preview.manifest_version,
    manifest_digest: preview.manifest_digest,
    cases: preview.cases.map((item, ordinal) => ({
      ordinal,
      case_key: item.case_key,
      keep_id: item.keep_id,
      merge_id: item.merge_id,
      state_digest: item.state_digest,
      stock: item.needs_stock_choice ? 'merge' : null,
    })),
  }
}

async function main() {
  // Validate the destination before retrieving any credential or request-file input.
  const base = validateLoopbackBase(process.env.F46_BASE)
  const requestFile = process.env.F46_PREVIEW_REQUEST_FILE
  const sessionCookie = process.env.F46_SESSION_COOKIE
  if (!requestFile || !sessionCookie) {
    throw new Error('Set F46_BASE, F46_PREVIEW_REQUEST_FILE, and F46_SESSION_COOKIE for a local native Worker fixture.')
  }

  const fixture = JSON.parse(fs.readFileSync(requestFile, 'utf8'))
  const previewRequest = fixture?.attempts?.[1]?.request ?? fixture?.request
  assert.ok(previewRequest && typeof previewRequest === 'object', 'fixture must carry the F46 preview request')

  const preview = await call(base, sessionCookie, '/api/products/possible-duplicates/merge-batch/preview', previewRequest)
  assert.equal(preview.success, true)
  assert.equal(preview.cases.length, 11, 'frozen native fixture carries eleven actionable cases')
  assert.equal(preview.skipped.length, 0)

  const apply = applyBody(preview)
  let result
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    result = await call(base, sessionCookie, '/api/products/possible-duplicates/merge-batch', apply)
    const committed = Array.isArray(result.committedCases) ? result.committedCases.length : 0
    const undoReady = Array.isArray(result.committedCases)
      ? result.committedCases.filter((item) => item.undoReady === true).length
      : 0
    console.log(JSON.stringify({ attempt, complete: result.complete === true, interruptionCode: result.interruptionCode ?? null, committed, undoReady }))
    if (result.complete === true) break
  }
  assert.ok(result?.complete === true, 'native Worker must complete within twelve resume requests')
  assert.equal(result.committedCases.length, 11)
  assert.ok(result.committedCases.every((item) => item.undoReady === true), 'every committed native case must be undo-ready')
  console.log('test-f46-finalizer-native: passed')
}

module.exports = { call, validateLoopbackBase }

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
