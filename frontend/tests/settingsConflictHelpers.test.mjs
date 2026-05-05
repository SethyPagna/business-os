import assert from 'node:assert/strict'
import { buildSettingsConflictState, diffSettingsConflictFields } from '../src/components/utils-settings/settingsConflict.js'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('settings conflict state preserves local draft and current server values', () => {
  const state = buildSettingsConflictState({
    attempted: { business_name: 'Local', theme: 'dark' },
    currentSettings: { business_name: 'Server', theme: 'light' },
    actualUpdatedAt: 'server-v2',
    expectedUpdatedAt: 'server-v1',
  })

  assert.equal(state.serverUpdatedAt, 'server-v2')
  assert.equal(state.expectedUpdatedAt, 'server-v1')
  assert.deepEqual(state.localDraft.business_name, 'Local')
  assert.deepEqual(state.serverSettings.business_name, 'Server')
})

await runTest('settings conflict diff only includes changed fields', () => {
  const rows = diffSettingsConflictFields({
    localDraft: { business_name: 'Local', theme: 'light' },
    serverSettings: { business_name: 'Server', theme: 'light' },
  })

  assert.deepEqual(rows, [{ key: 'business_name', localValue: 'Local', serverValue: 'Server' }])
})

if (failed > 0) {
  process.exitCode = 1
}
