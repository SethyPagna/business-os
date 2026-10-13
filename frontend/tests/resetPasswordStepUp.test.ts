// SEC-4 / audit B2: every data wipe (Sales/Full Data Reset, the Products reset, and the four page resets) asks for
// the signed-in account's current password, and the Worker refuses without it
// (cloudflare/scripts/test-reset-password-step-up-native.cjs drives the real routes). This pins the browser half:
// the confirm dialog's password field, the values it forwards, and the two language packs' wording for the refusal
// codes the Worker answers with.
import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8')
const resetData = read('../src/components/utils-settings/ResetData.tsx')
const runtime = read('../src/api/systemRuntime.ts')
const methods = read('../src/api/methods.ts')
const system = read('../../cloudflare/src/routes/system.ts')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  assert.ok(start > -1, `${from} not found`)
  const end = source.indexOf(to, start + from.length)
  assert.ok(end > -1, `${to} not found after ${from}`)
  return source.slice(start, end)
}

const confirmReset = between(resetData, 'function ConfirmReset(', '// Ticks once a second')
const dataResetPanel = between(resetData, 'function ResetData(', 'type SectionMode')
const sectionResetPanel = between(resetData, 'function SectionReset(', 'function FactoryReset(')
const finalizePanel = between(resetData, 'function MigrationFinalize(', 'export {')

await runTest('the confirm dialog shows a current-password field only when the reset asks for one', () => {
  assert.match(confirmReset, /requirePassword = false/)
  assert.match(confirmReset, /\{requirePassword \? \(\s*<>[\s\S]*type="password"[\s\S]*autoComplete="current-password"[\s\S]*<\/>\s*\) : null\}/)
  assert.match(confirmReset, /T\('current_password', 'Current password'\)/)
})

await runTest('the confirm button stays disabled until the password is typed, and forwards it', () => {
  assert.match(confirmReset, /disabled=\{[^}]*\(requirePassword && !currentPassword\)[^}]*\}/)
  assert.match(confirmReset, /onConfirm\(\{ confirm: typed, acknowledged: true, \.\.\.\(requirePassword \? \{ currentPassword \} : \{\}\) \}\)/)
})

await runTest('the typed password never survives a finished, cancelled or failed attempt', () => {
  assert.match(confirmReset, /wasWorkingRef\.current = false[\s\S]{0,200}setCurrentPassword\(''\)/)
  assert.match(confirmReset, /onClick=\{\(\) => \{ setStep\(0\); setTyped\(''\); setAcknowledged\(false\); setCurrentPassword\(''\) \}\}/)
})

await runTest('Data Reset and the page resets require the password; the migration-finalize steps do not', () => {
  assert.match(dataResetPanel, /<ConfirmReset[\s\S]*?\brequirePassword\b[\s\S]*?\/>/)
  assert.match(sectionResetPanel, /<ConfirmReset[\s\S]*?\brequirePassword\b[\s\S]*?\/>/)
  assert.ok(!/requirePassword/.test(finalizePanel), 'migration finalize only zeroes counts and keeps its own dialog')
})

await runTest('both resets refuse to call the API without a password and forward the one typed', () => {
  assert.match(dataResetPanel, /!currentPassword\) return/)
  assert.match(dataResetPanel, /resetData\?\.\(mode, \{ \.\.\.confirmation, currentPassword \}\)/)
  assert.match(sectionResetPanel, /if \(!currentPassword\) return/)
  assert.match(sectionResetPanel, /resetData\?\.\('products', \{ \.\.\.productToggles, \.\.\.confirmation, currentPassword \}\)/)
  assert.match(sectionResetPanel, /resetSection\?\.\(selected\.id as SectionMode, \{ currentPassword \}\)/)
})

await runTest('the transport sends the password with reset-data and reset-section', () => {
  const resetDataFn = between(runtime, 'export async function resetData(', 'export async function resetSection(')
  assert.match(resetDataFn, /currentPassword: string/)
  assert.match(resetDataFn, /!options\?\.currentPassword\) throw new Error/)
  assert.match(resetDataFn, /apiFetch\('POST', '\/api\/system\/reset-data', \{ mode, \.\.\.options \}/)
  const resetSectionFn = between(runtime, 'export async function resetSection(', 'export async function factoryReset(')
  assert.match(resetSectionFn, /if \(!confirmation\?\.currentPassword\) throw new Error/)
  assert.match(resetSectionFn, /\{ section, currentPassword: confirmation\.currentPassword \}/)
  assert.match(methods, /export async function resetSection\(section, confirmation\) \{\s*const result = await callSystemRuntimeMethod\('resetSection', section, confirmation\)/)
})

await runTest('the Worker answers with the codes the packs translate, in both languages', () => {
  for (const code of ['current_password_required', 'incorrect_password']) {
    assert.ok(system.includes(`code: '${code}'`), `${code} must be a code system.ts returns`)
    assert.ok(en[code] && km[code], `${code} needs text in both packs`)
    assert.notEqual(en[code], km[code])
  }
  assert.ok(en.reset_password_hint && km.reset_password_hint, 'the dialog hint needs both packs')
  assert.ok(/No data was changed/.test(en.incorrect_password) && /No data was changed/.test(en.current_password_required))
})

await runTest('the Worker asks for the password after the cheap checks and before any backup or delete', () => {
  const resetDataRoute = between(system, "app.post('/reset-data'", 'createCloudflareBackup')
  assert.ok(resetDataRoute.indexOf('reset_acknowledgement_required') < resetDataRoute.indexOf('denyUnlessCurrentPassword(c, body, 403)'))
  const resetSectionRoute = between(system, "app.post('/reset-section'", 'createSectionBackup')
  assert.ok(resetSectionRoute.indexOf('RESETTABLE_SECTIONS.includes(section)') < resetSectionRoute.indexOf('denyUnlessCurrentPassword(c, body, 403)'))
  assert.match(system, /denyUnlessCurrentPassword\(c, body, 400\)/, 'factory-reset keeps its pinned 400 refusal through the same helper')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll resetPasswordStepUp tests passed')
}
