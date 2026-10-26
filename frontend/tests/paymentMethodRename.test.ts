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
assert.match(settingsSource, /if \(!renameDraft \|\| !renamedTo \|\| renamedTo === renameDraft\.from\) return/)
assert.doesNotMatch(settingsSource, /if \(!to \|\| to\.toLocaleLowerCase\(\) === from\.toLocaleLowerCase\(\)\) return/)
assert.match(settingsSource, /const isCaseOnlyRename = to\.toLocaleLowerCase\(\) === from\.toLocaleLowerCase\(\)/)
assert.match(settingsSource, /const scope: PaymentMethodRenameScope = isCaseOnlyRename \|\| linked > 0 \? 'linked' : 'settings_only'/)
// FX-ui: the linked-rename question is the shared ConfirmDialog (before/after),
// never window.confirm; declining still returns before replacePaymentMethod.
assert.match(settingsSource, /if \(scope === 'linked'\) \{[\s\S]*?await askForPassword\(request, async \(currentPassword\) => \{[\s\S]*?await replacePaymentMethod\(\{[^}]*currentPassword/)
assert.doesNotMatch(settingsSource, /window\.confirm\(/)

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
    currentPassword: 'typed-in-the-dialog',
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
    currentPassword: 'typed-in-the-dialog',
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
    () => replacePaymentMethod({ from: 'Card', to: 'CARD', scope: 'linked', currentPassword: 'typed-in-the-dialog' }),
    /returned no canonical method list/,
  )
  // Browser half of the step-up: a linked rename without the password never reaches the network.
  const callsBefore = calls.length
  await assert.rejects(() => replacePaymentMethod({ from: 'Card', to: 'CARD', scope: 'linked' }), /requires the current password/)
  assert.equal(calls.length, callsBefore)
  // A settings-only rename rewrites no sale, so it carries no password.
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    assert.equal('currentPassword' in JSON.parse(String(init?.body || '{}')), false)
    return Promise.resolve(new Response(JSON.stringify({ success: true, methods: ['Cash'] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  }) as typeof fetch
  await replacePaymentMethod({ from: 'Card', to: 'Debit', scope: 'settings_only' })
} finally {
  globalThis.fetch = originalFetch
  resetApiState()
}

console.log('PASS payment-method case-only rename preserves the exact canonical server contract')
