// Every data wipe (Sales/Full Data Reset, the Products reset, the four page resets and both
// migration-finalize steps) asks for the signed-in account's current password, and the Worker refuses without it
// (cloudflare/scripts/test-reset-password-step-up-native.cjs drives the real routes). This pins the browser half:
// the confirm dialog's password field, the values it forwards, and the two language packs' wording for the refusal
// codes the Worker answers with.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

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
const stepUp = read('../../cloudflare/src/lib/destructiveStepUp.ts')
const backupsRoute = read('../../cloudflare/src/routes/backups.ts')
const backupPanel = read('../src/components/utils-settings/Backup.tsx')
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

await runTest('Data Reset, the page resets and both migration-finalize steps require the password', () => {
  assert.match(dataResetPanel, /<ConfirmReset[\s\S]*?\brequirePassword\b[\s\S]*?\/>/)
  assert.match(sectionResetPanel, /<ConfirmReset[\s\S]*?\brequirePassword\b[\s\S]*?\/>/)
  assert.equal((finalizePanel.match(/<ConfirmReset\b/g) || []).length, 2, 'the finalize panel has the zero-stock and the park-lots dialogs')
  assert.equal((finalizePanel.match(/^\s*requirePassword$/gm) || []).length, 2, 'both finalize dialogs ask for the password')
  assert.equal((finalizePanel.match(/username=\{String\(user\?\.username \|\| ''\)\}/g) || []).length, 2, 'and give the browser the account name to pair it with')
})

await runTest('both resets refuse to call the API without a password and forward the one typed', () => {
  assert.match(dataResetPanel, /!currentPassword\) return/)
  assert.match(dataResetPanel, /resetData\?\.\(mode, \{ \.\.\.confirmation, currentPassword \}\)/)
  assert.match(sectionResetPanel, /if \(!currentPassword\) return/)
  assert.match(sectionResetPanel, /resetData\?\.\('products', \{ \.\.\.productToggles, \.\.\.confirmation, currentPassword \}\)/)
  assert.match(finalizePanel, /\{ currentPassword \}: ResetSubmission, onSuccess: \(\) => void\) => \{\s*if \(!currentPassword\) return/)
  assert.match(finalizePanel, /finalizeMigration\?\.\(step, \{ currentPassword \}\)/)
  assert.match(finalizePanel, /onConfirm=\{\(confirmation\) => runStep\('zero_stock', confirmation,/)
  assert.match(finalizePanel, /onConfirm=\{\(confirmation\) => runStep\('park_lots', confirmation,/)
  assert.match(sectionResetPanel, /resetSection\?\.\(selected\.id as SectionMode, \{ \.\.\.confirmation, currentPassword \}\)/)
  assert.match(sectionResetPanel, /confirmation\?\.acknowledged !== true \|\| confirmation\?\.confirm !== selected\.word\) return/, 'every page reset, not only Products, sends the phrase it was asked for')
})

await runTest('the transport sends the password with reset-data and reset-section', () => {
  const resetDataFn = between(runtime, 'export async function resetData(', 'export async function resetSection(')
  assert.match(resetDataFn, /currentPassword: string/)
  assert.match(resetDataFn, /!options\?\.currentPassword\) throw new Error/)
  assert.match(resetDataFn, /apiFetch\('POST', '\/api\/system\/reset-data', \{ mode, \.\.\.options \}/)
  const resetSectionFn = between(runtime, 'export async function resetSection(', 'export async function factoryReset(')
  assert.match(resetSectionFn, /confirmation\?\.acknowledged !== true \|\| !confirmation\?\.confirm \|\| !confirmation\?\.currentPassword\) throw new Error/)
  assert.match(resetSectionFn, /\{ section, confirm: confirmation\.confirm, acknowledged: true, currentPassword: confirmation\.currentPassword \}/)
  assert.match(methods, /export async function resetSection\(section, confirmation\) \{\s*const result = await callSystemRuntimeMethod\('resetSection', section, confirmation\)/)
  const finalizeFn = between(runtime, 'export async function finalizeMigration(', 'export async function openPath(')
  assert.match(finalizeFn, /if \(!confirmation\?\.currentPassword\) throw new Error/)
  assert.match(finalizeFn, /\{ step, currentPassword: confirmation\.currentPassword \}/)
  assert.match(methods, /export async function finalizeMigration\(step, confirmation\) \{\s*const result = await callSystemRuntimeMethod\('finalizeMigration', step, confirmation\)/)
})

await runTest('the Worker answers with the codes the packs translate, in both languages', () => {
  for (const code of ['current_password_required', 'incorrect_password']) {
    assert.ok(stepUp.includes(`'${code}'`), `${code} must be a code the step-up returns`)
    assert.ok(en[code] && km[code], `${code} needs text in both packs`)
    assert.notEqual(en[code], km[code])
  }
  assert.ok(en.reset_password_hint && km.reset_password_hint, 'the dialog hint needs both packs')
  assert.ok(/No data was changed/.test(en.incorrect_password) && /No data was changed/.test(en.current_password_required))
})

await runTest('unavailable legacy stock finalization uses the actual error formatter in EN and KM', () => {
  const tree = ts.createSourceFile('ResetData.tsx', resetData, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const functions = tree.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['getErrorMessage', 'describeError'].includes(node.name?.text || ''))
  assert.equal(functions.length, 2)
  const code = ts.transpileModule(functions.map(node => node.getText(tree)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const describe = new Function(`${code}\nreturn describeError`)() as (error: unknown, T: (key: string, fallback: string) => string) => string
  const error = Object.assign(new Error('server refusal'), { code: 'migration_stock_finalize_unavailable', status: 409 })
  assert.ok(system.includes(`code: '${error.code}'`))
  for (const pack of [en, km]) {
    assert.ok(pack[error.code])
    assert.equal(describe(error, (key, fallback) => pack[key] || fallback), pack[error.code])
    assert.notEqual(describe(error, key => pack[key] || key), error.code)
  }
  assert.notEqual(en[error.code], km[error.code])
  assert.equal(describe(error, key => key), 'server refusal', 'missing translations retain the server message')
  assert.equal(describe(new Error('ordinary failure'), key => key), 'ordinary failure')
})

await runTest('a backup restore asks for the built-in admin and the password after the dry run returns, and the dialog sends it', () => {
  const restoreBranch = between(backupsRoute, "if (type === 'import-folder') {", 'beginMaintenance(c.env')
  assert.ok(restoreBranch.indexOf('body.dryRun === true') < restoreBranch.indexOf("denyUnlessDefaultAdmin(c, 'restore')"), 'a dry-run validation stays under the plain backup gate')
  assert.ok(restoreBranch.indexOf("denyUnlessDefaultAdmin(c, 'restore')") < restoreBranch.indexOf('denyUnlessCurrentPassword(c, body, 403)'))
  assert.match(backupPanel, /queueBackupFolderRestore\?\.\(folderImportPath, \{ currentPassword: restorePassword \}\)/)
})

await runTest('reset-data and reset-section share one phrase-and-acknowledgement check, phrase first', () => {
  const helper = between(system, 'function denyUnlessResetConfirmed(', 'function resetDeleteStatements(')
  assert.ok(helper.indexOf("code: 'reset_confirm_required'") > 0)
  assert.ok(helper.indexOf("code: 'reset_confirm_required'") < helper.indexOf("code: 'reset_acknowledgement_required'"))
  for (const code of ['reset_confirm_required', 'reset_acknowledgement_required']) assert.ok(en[code] && km[code], `${code} needs text in both packs`)
  for (const [section, phrase] of [['customers', 'RESET CUSTOMERS'], ['suppliers', 'RESET SUPPLIERS'], ['delivery_contacts', 'RESET DELIVERY CONTACTS'], ['audit_log', 'RESET AUDIT LOG']]) {
    const entry = system.split('\n').find((line) => line.trim().startsWith(`${section}: { tables:`)) || ''
    assert.ok(entry.includes(`phrase: '${phrase}'`), `${section} must ask for ${phrase}`)
    assert.ok(resetData.includes(`word: '${phrase}'`), `the dialog must ask for the same ${phrase}`)
  }
})

await runTest('the Worker asks for the password after the cheap checks and before any backup or delete', () => {
  const resetDataRoute = between(system, "app.post('/reset-data'", 'createCloudflareBackup')
  assert.ok(resetDataRoute.indexOf('denyUnlessResetConfirmed(c, body, phrase)') > 0)
  assert.ok(resetDataRoute.indexOf('denyUnlessResetConfirmed(c, body, phrase)') < resetDataRoute.indexOf('denyUnlessCurrentPassword(c, body, 403)'))
  const resetSectionRoute = between(system, "app.post('/reset-section'", 'createSectionBackup')
  assert.ok(resetSectionRoute.indexOf('RESETTABLE_SECTIONS.includes(section)') < resetSectionRoute.indexOf('denyUnlessResetConfirmed(c, body, config.phrase)'))
  assert.ok(resetSectionRoute.indexOf('denyUnlessResetConfirmed(c, body, config.phrase)') < resetSectionRoute.indexOf('denyUnlessCurrentPassword(c, body, 403)'))
  assert.match(system, /denyUnlessCurrentPassword\(c, body, 400\)/, 'factory-reset keeps its pinned 400 refusal through the same helper')
  const finalizeRoute = between(system, "app.post('/finalize-migration'", 'createSectionBackup(c.env, backupTables')
  assert.equal(finalizeRoute.split('denyUnlessCurrentPassword(c, body, 403)').length - 1, 1, 'finalize-migration asks once, for the two stock steps only')
  assert.ok(finalizeRoute.indexOf('if (step === LEGACY_SUBTOTAL_REPAIR_STEP)') < finalizeRoute.indexOf('denyUnlessCurrentPassword(c, body, 403)'), 'the one-off repair steps keep their own contracts and return before it')
  const orphanRoute = between(system, "app.post('/import-retention/orphans'", 'cleanOrphanImportStaging(c.env')
  assert.ok(orphanRoute.indexOf('if (apply) {') > -1 && orphanRoute.indexOf('if (apply) {') < orphanRoute.indexOf('denyUnlessCurrentPassword(c, body, 403)'), 'only the forced delete asks; the dry-run report does not')
})

await runTest('audit retention is saved through its own endpoint with the password, never through the generic settings save', () => {
  const component = read('../src/components/utils-settings/AuditRetentionSetting.tsx')
  const settingsPanel = read('../src/components/utils-settings/Settings.tsx')
  const transport = read('../src/api/settingsTransport.ts')
  const policy = read('../../cloudflare/src/lib/auditRetentionPolicy.ts')
  assert.match(transport, /apiFetch\('PUT', '\/api\/settings\/audit-log-retention', \{ days, currentPassword: confirmation\.currentPassword \}\)/)
  assert.match(component, /saveAuditLogRetention\(Number\(trimmed\), \{ currentPassword \}\)/)
  assert.match(component, /type="password"[\s\S]{0,120}autoComplete="current-password"/)
  assert.match(component, /if \(!currentPassword\) return notify\(/)
  assert.match(settingsPanel, /<AuditRetentionSetting/)
  assert.match(settingsPanel, /SERVER_OWNED_SETTING_KEYS = new Set\(\['audit_log_retention_days'\]\)/)
  assert.ok(!/name="audit_log_retention_days"/.test(settingsPanel), 'the generic Settings form no longer carries the field')
  const floor = policy.match(/AUDIT_LOG_RETENTION_FLOOR_DAYS = (\d+)/)?.[1]
  const ceiling = policy.match(/AUDIT_LOG_RETENTION_MAX_DAYS = (\d+)/)?.[1]
  assert.equal(component.match(/const MIN_DAYS = (\d+)/)?.[1], floor, 'the control and the Worker agree on the floor')
  assert.equal(component.match(/const MAX_DAYS = (\d+)/)?.[1], ceiling, 'and on the ceiling')
  assert.ok(en.invalid_audit_retention_days && km.invalid_audit_retention_days, 'the refusal needs text in both packs')
  assert.notEqual(en.invalid_audit_retention_days, km.invalid_audit_retention_days)
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll resetPasswordStepUp tests passed')
}
