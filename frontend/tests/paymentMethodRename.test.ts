import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { __resetApiHealthForTests, __resetApiWriteDedupeForTests, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'
import { getPaymentMethodImpact, replacePaymentMethod } from '../src/api/settingsTransport.ts'

type FetchCall = Parameters<typeof fetch>

const settingsSource = readFileSync(new URL('../src/components/utils-settings/Settings.tsx', import.meta.url), 'utf8')

function resetApiState() {
  __resetApiWriteDedupeForTests()
  __resetApiHealthForTests()
  setSyncServerUrl('')
  setSyncToken('')
}

// The reported defect was specifically a spelling-only correction: the old
// case-folded early return made Fcb -> FCB impossible before the server ever
// saw it. Exact equality remains a no-op, but identity equality does not.
assert.match(settingsSource, /if \(!to \|\| to === from\) return/)
assert.doesNotMatch(settingsSource, /if \(!to \|\| to\.toLocaleLowerCase\(\) === from\.toLocaleLowerCase\(\)\) return/)
assert.match(settingsSource, /const isCaseOnlyRename = to\.toLocaleLowerCase\(\) === from\.toLocaleLowerCase\(\)/)
assert.match(settingsSource, /const scope: PaymentMethodRenameScope = isCaseOnlyRename \|\| linked > 0 \? 'linked' : 'settings_only'/)
assert.match(settingsSource, /if \(scope === 'linked' && !window\.confirm\([\s\S]*?\)\) return/)

// Configured choices keep one case-insensitive identity. A cashier cannot add
// FCB beside Fcb; the explicit rename path above is the only way to change the
// canonical spelling.
assert.match(settingsSource, /const seen = new Set<string>\(\)/)
assert.match(settingsSource, /const normalized = method\.toLocaleLowerCase\(\)/)
assert.match(settingsSource, /seen\.has\(normalized\)/)
assert.match(settingsSource, /const savePaymentMethods = async \(updated: string\[\]\): Promise<boolean> => \{\s*const normalized = normalizePaymentMethods\(updated\)/)

resetApiState()
setSyncServerUrl('https://sync.example.test')
const originalFetch = globalThis.fetch
const calls: FetchCall[] = []

globalThis.fetch = ((...args: FetchCall) => {
  calls.push(args)
  const [url, init] = args
  const path = String(url)
  if (String(init?.method || 'GET').toUpperCase() === 'GET') {
    assert.match(path, /\/api\/settings\/payment-methods\/impact\?from=Fcb&to=FCB$/)
    return Promise.resolve(new Response(JSON.stringify({
      from: 'Fcb',
      to: 'FCB',
      linked_records: 2,
      configured_methods: ['Cash', 'Fcb'],
      settings_updated_at: '2026-09-05 15:30:00',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }
  assert.match(path, /\/api\/settings\/payment-methods\/replace$/)
  const body = JSON.parse(String(init?.body || '{}'))
  assert.deepEqual(body, {
    from: 'Fcb',
    to: 'FCB',
    scope: 'linked',
    expected_updated_at: '2026-09-05 15:30:00',
  })
  return Promise.resolve(new Response(JSON.stringify({
    success: true,
    methods: ['Cash', 'FCB'],
    scope: 'linked',
    settings_updated_at: '2026-09-05 15:30:01',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}) as typeof fetch

try {
  const impact = await getPaymentMethodImpact('Fcb', 'FCB')
  const result = await replacePaymentMethod({
    from: 'Fcb',
    to: 'FCB',
    scope: 'linked',
    expected_updated_at: impact.settings_updated_at || undefined,
  })
  assert.deepEqual(result.methods, ['Cash', 'FCB'])
  assert.equal(calls.length, 2)

  // A successful-looking response without the server's canonical list must
  // fail loudly. Falling back to the stale local labels would immediately
  // repaint Fcb after the server had accepted FCB.
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))) as typeof fetch
  await assert.rejects(
    () => replacePaymentMethod({ from: 'Card', to: 'CARD', scope: 'linked' }),
    /returned no canonical method list/,
  )
} finally {
  globalThis.fetch = originalFetch
  resetApiState()
}

console.log('PASS payment-method case-only rename preserves the exact canonical server contract')
