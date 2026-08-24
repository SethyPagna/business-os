import assert from 'node:assert/strict'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import { saveSettings } from '../src/api/settingsTransport.ts'

type TestCallback = () => void | Promise<void>
type FetchCall = Parameters<typeof fetch>

let failed = 0

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function resetApiState() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('')
  setSyncToken('')
}

function conflictResponse(actualUpdatedAt: string, currentSettings: Record<string, unknown>): Response {
  return new Response(JSON.stringify({
    error: 'Portal settings changed on another device.',
    code: 'write_conflict',
    conflict: true,
    actualUpdatedAt,
    currentSettings,
  }), { status: 409, headers: { 'Content-Type': 'application/json' } })
}

function okSettingsResponse(updatedAt: string): Response {
  return new Response(JSON.stringify({ success: true, updatedAt }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function manyKeyUpdate(): Record<string, string> {
  const update: Record<string, string> = {}
  for (let i = 0; i < 12; i += 1) update[`customer_portal_field_${i}`] = `value-${i}`
  return update
}

// Real, confirmed bug (see settingsTransport.ts's saveSettingsOnce comment,
// Part 100/120): the self-heal retry used to bail out for any save touching
// more than 2 keys, which is exactly the shape of the portal editor's single
// bulk save (~60 customer_portal_*/business_* keys at once) -- so a stale-
// cache conflict there always surfaced as a manual "reload and retry" error
// to the person instead of quietly resolving itself the way small saves
// already did. A prior session (Part 101) also correctly flagged that just
// widening the retry unconditionally would let a genuine concurrent edit
// from someone else get silently overwritten on a large save. These tests
// cover the actual fix: a many-key save only self-heals when every touched
// key's post-conflict server value still matches the caller-supplied
// pre-edit baseline (nothing real actually changed); a many-key save where
// the server's value genuinely diverged from that baseline for a touched
// key still surfaces the honest conflict error, same as before this fix.
await runTest('many-key save self-heals when the conflict is a false positive (no field actually diverged from baseline)', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const update = manyKeyUpdate()
  // The baseline matches every key's eventual `currentSettings` value below
  // -- i.e. nobody actually changed any field this save touches; the
  // conflict was a stale-metadata false positive.
  const baselineSettings: Record<string, string> = {}
  for (const key of Object.keys(update)) baselineSettings[key] = `unchanged-${key}`

  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    const [url, init] = args
    const path = String(url)
    // With skipExpectedUpdatedAt, the first attempt's payload carries no
    // expectedUpdatedAt at all -- it's the retry (below) that starts
    // supplying one, once the server has told it what to use.
    if (String(init?.method || 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'))
      if (!body.expectedUpdatedAt) {
        const currentSettings: Record<string, string> = {}
        for (const key of Object.keys(update)) currentSettings[key] = baselineSettings[key]
        return Promise.resolve(conflictResponse('server-v1', currentSettings))
      }
      if (body.expectedUpdatedAt === 'server-v1') return Promise.resolve(okSettingsResponse('server-v2'))
      return Promise.resolve(conflictResponse('server-v2', {}))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch

  try {
    const result = await saveSettings(update, { skipExpectedUpdatedAt: true, baselineSettings }) as Record<string, unknown>
    assert.equal(result?.success, true)
    assert.equal(result?.updatedAt, 'server-v2')
    const postCalls = calls.filter(([, init]) => String(init?.method || 'GET').toUpperCase() === 'POST')
    assert.equal(postCalls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('many-key save surfaces a real conflict instead of overwriting a field someone else actually changed', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const update = manyKeyUpdate()
  const baselineSettings: Record<string, string> = {}
  for (const key of Object.keys(update)) baselineSettings[key] = `unchanged-${key}`

  globalThis.fetch = ((...args: FetchCall) => {
    const [url, init] = args
    const path = String(url)
    if (String(init?.method || 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'))
      if (!body.expectedUpdatedAt) {
        // Someone else genuinely changed ONE of the fields this save
        // touches -- its currentSettings value no longer matches baseline.
        const currentSettings: Record<string, string> = {}
        for (const key of Object.keys(update)) currentSettings[key] = baselineSettings[key]
        currentSettings.customer_portal_field_3 = 'someone-elses-real-edit'
        return Promise.resolve(conflictResponse('server-v1', currentSettings))
      }
      return Promise.resolve(conflictResponse('server-v2', {}))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch

  try {
    await assert.rejects(
      () => saveSettings(update, { skipExpectedUpdatedAt: true, baselineSettings }),
      (error: any) => {
        assert.equal(error?.conflict, true)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('many-key save without a baseline keeps the pre-fix behavior (surfaces the conflict, does not guess)', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const update = manyKeyUpdate()

  globalThis.fetch = ((...args: FetchCall) => {
    const [, init] = args
    if (String(init?.method || 'GET').toUpperCase() === 'POST') {
      return Promise.resolve(conflictResponse('server-v1', { customer_portal_field_0: 'value-0' }))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch

  try {
    // No `baselineSettings` passed -- same as every caller before this fix.
    await assert.rejects(
      () => saveSettings(update, { skipExpectedUpdatedAt: true }),
      (error: any) => {
        assert.equal(error?.conflict, true)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

await runTest('small (<=2 key) save keeps the original unconditional auto-retry, unaffected by this change', async () => {
  resetApiState()
  setSyncServerUrl('https://sync.example.test')
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = ((...args: FetchCall) => {
    calls.push(args)
    const [, init] = args
    if (String(init?.method || 'GET').toUpperCase() === 'POST') {
      const body = JSON.parse(String(init?.body || '{}'))
      if (!body.expectedUpdatedAt) return Promise.resolve(conflictResponse('server-v1', { theme: 'server-value' }))
      if (body.expectedUpdatedAt === 'server-v1') return Promise.resolve(okSettingsResponse('server-v2'))
      return Promise.resolve(conflictResponse('server-v2', {}))
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch

  try {
    // No baseline supplied at all -- the <=2-key path never needed one.
    const result = await saveSettings({ theme: 'dark' }, { skipExpectedUpdatedAt: true }) as Record<string, unknown>
    assert.equal(result?.success, true)
    assert.equal(result?.updatedAt, 'server-v2')
    const postCalls = calls.filter(([, init]) => String(init?.method || 'GET').toUpperCase() === 'POST')
    assert.equal(postCalls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    resetApiState()
  }
})

if (failed > 0) {
  process.exitCode = 1
}
