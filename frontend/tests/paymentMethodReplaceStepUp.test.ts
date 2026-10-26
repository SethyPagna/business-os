// POST /api/settings/payment-methods/replace with scope "linked" rewrites the payment method on past
// sales, so it asks for the signed-in account's current password like the other destructive routes.
// The Worker half is driven end to end by cloudflare/scripts/test-payment-method-replace-step-up-native.cjs;
// this pins the browser half and that both halves still agree: the same scope, the same body key, the
// refusal codes both language packs already carry, and the order (password before any read or write).
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const route = read('../../cloudflare/src/routes/settings.ts')
const settings = read('../src/components/utils-settings/Settings.tsx')
const transport = read('../src/api/settingsTransport.ts')
const hook = read('../src/components/shared/useConfirmDialog.tsx')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

const handler = route.slice(route.indexOf("app.post('/payment-methods/replace'"))
const handlerBody = handler.slice(0, handler.indexOf("\napp.", 10))

runTest('the Worker asks for the current password for a linked rename, before any lookup or write', () => {
  const gate = handlerBody.indexOf("if (scope === 'linked') {")
  assert.ok(gate > -1, 'linked scope is gated')
  assert.match(handlerBody.slice(gate, gate + 400), /denyUnlessCurrentPassword\(c, body, 403\)/)
  for (const later of ['loadPaymentMethodSetting(', 'loadPaymentMethodCandidates(', 'sale_write_revisions']) {
    const at = handlerBody.indexOf(later)
    assert.ok(at > gate, `${later} must come after the password check`)
  }
  // The settings permission gate still runs first, so a caller without it is refused before the password is read.
  assert.ok(handlerBody.indexOf('denyUnlessPaymentMethodPermission(c)') < gate)
})

runTest('the browser sends the password under the key the Worker reads, only for a linked rename', () => {
  assert.match(transport, /currentPassword\?: string/)
  assert.match(transport, /payload\.scope === 'linked' && !payload\.currentPassword\) throw/)
  assert.match(settings, /await askForPassword\(request, async \(currentPassword\) => \{/)
  assert.match(settings, /replacePaymentMethod\(\{ from, to, scope, expected_updated_at: expectedUpdatedAt, currentPassword \}\)/)
  assert.match(settings, /const refusal = stepUpRefusalText\(attemptError, t\)\s*if \(refusal\) return refusal/)
})

runTest('the shared dialog hook offers a password field that gates Confirm and resolves null on every other outcome', () => {
  assert.match(hook, /askForPassword = useCallback/)
  assert.match(hook, /confirmDisabled=\{pending\.attempt \? !password : false\}/)
  assert.match(hook, /type="password"/)
  assert.match(hook, /autoComplete="current-password"/)
  assert.match(hook, /askForPassword = useCallback\(\(request: ConfirmRequest, attempt: PasswordAttempt\)/)
  assert.match(hook, /<p role="alert"/)
})

runTest('the refusal codes the Worker answers with are translated in both packs', () => {
  for (const code of ['current_password', 'current_password_required', 'incorrect_password', 'current_password_rate_limited']) {
    assert.ok(en[code], `en has ${code}`)
    assert.ok(km[code], `km has ${code}`)
  }
  assert.match(settings, /STEP_UP_REFUSAL_CODES = \['current_password_required', 'incorrect_password', 'current_password_rate_limited'\]/)
})

if (failed) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
