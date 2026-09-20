import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

const text = fs.readFileSync(new URL('../src/web-api.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('web-api.ts', text, ts.ScriptTarget.Latest, true)
const names = ['queueBusinessOutboxOperation', 'queueOfflineFileChunks', 'syncUnlockedOfflineOutbox', 'syncUnlockedOfflineFileChunks']
const functions = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && [...names, 'runOfflineMaintenance', 'ensureSessionRecoveryListeners'].includes(node.name?.text || '')).map((node) => node.getText(parsed)).join('\n')
const apiDeclaration = parsed.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []).find((node) => node.name.getText(parsed) === 'staticApi')!
const initializer = apiDeclaration.initializer!
assert.ok(ts.isObjectLiteralExpression(initializer))
const exposed = initializer.properties.filter((node) => ts.isShorthandPropertyAssignment(node) && names.includes(node.name.text)).map((node) => node.getText(parsed))
assert.equal(exposed.length, 4, 'legacy API methods must remain explicit denials, not fall through the generic proxy')
const records = [{ id: 'legacy-A', encrypted_payload: 'ciphertext-A', iv: 'iv-A', status: 'pending' }, { id: 'legacy-B', upload_id: 'file-B', chunk_index: 0, data: 'original bytes', status: 'ready' }]
const before = structuredClone(records)
let forbiddenCalls = 0
let reads = 0
let actor = 'A'
let authenticated = true
const forbidden = () => { forbiddenCalls++; throw Error('No queue/database/decryption/network mutation is allowed') }
const windowTarget = new EventTarget()
const documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' })
const navigatorState = { onLine: true }
const dependencies = {
  navigator: navigatorState, window: windowTarget, document: documentTarget,
  offlineVaultKey: {}, hasStoredUserSession: () => authenticated && !!actor,
  getOfflineDb: forbidden, encryptOfflineVaultValue: forbidden, decryptOfflineVaultValue: forbidden,
  apiFetch: forbidden, registerOutboxBackgroundSync: forbidden, emitSyncQueueChanged: forbidden,
  scheduleOfflineVaultIdleLock: forbidden,
  refreshOfflineSnapshotSoon: () => { reads++ }, refreshServiceWorkerSoon: () => { reads++ },
  resumeWS() {}, startHealthCheck() {}, pingServerHealth: async () => ({}), dispatchSyncUpdates() {},
  FOREGROUND_RECOVERY_THROTTLE_MS: 0, FOREGROUND_REFRESH_AFTER_MS: 45000, FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS: [],
}
const compiled = ts.transpileModule(`let sessionRecoveryListenersRegistered = false, lastForegroundRecoveryAt = 0, deferredForegroundRecoveryTimer = 0, backgroundedAt = 0;\n${functions}\nreturn { api: {${exposed.join(',')}}, runOfflineMaintenance, ensureSessionRecoveryListeners };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const runtime = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies))
for (const currentActor of ['A', 'B']) {
  actor = currentActor
  for (const online of [false, true]) {
    navigatorState.onLine = online
    for (const name of names) {
      const admission = name.startsWith('queue')
      await assert.rejects(runtime.api[name]({ operation_id: 'products.update', payload: { id: 1 }, slice() {}, force: true }, { upload_id: 'new-upload' }), (error: any) => error.code === (admission ? 'online_required' : 'legacy_recovery_required'))
      assert.deepEqual(records, before, 'legacy encrypted records/files must remain byte-for-byte unchanged')
    }
  }
}
assert.equal(forbiddenCalls, 0)
runtime.ensureSessionRecoveryListeners()
for (const online of [false, true]) {
  navigatorState.onLine = online
  const priorReads = reads
  windowTarget.dispatchEvent(new Event('online'))
  windowTarget.dispatchEvent(new Event('focus'))
  windowTarget.dispatchEvent(new Event('sync:reconnected'))
  documentTarget.dispatchEvent(new Event('visibilitychange'))
  windowTarget.dispatchEvent(new Event('pageshow'))
  runtime.runOfflineMaintenance(true)
  if (online) assert.ok(reads > priorReads, 'reconnect must preserve cached-read/app-shell refresh')
  else assert.equal(reads, priorReads)
}
authenticated = false
const priorReads = reads
windowTarget.dispatchEvent(new Event('sync:reconnected'))
assert.equal(reads, priorReads)
assert.equal(forbiddenCalls, 0, 'reconnect cannot decrypt, post, queue, delete, or update retained work')
assert.deepEqual(records, before)
console.log('PASS exported generic queue admission/replay deny without writes; actual reconnect handlers refresh reads only')
