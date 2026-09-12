import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import {
  CUSTOMER_GENDER_RESTORATION_CAMPAIGN,
  CUSTOMER_GENDER_RESTORATION_CHUNKS,
  CUSTOMER_GENDER_RESTORATION_TOTAL,
  activateGenderRestorationLifecycle,
  claimGenderRestorationAction,
  executeCustomerGenderRestorationChunk,
  parseCustomerGenderRestorationFile,
  releaseGenderRestorationAction,
  remainingGenderRestorationChunks,
  type GenderRestorationChunk,
  type GenderRestorationFile,
  type GenderRestorationReceipt,
  type GenderRestorationStatus,
} from '../src/components/contacts/customerGenderRestorationFlow.ts'

const row = (id: number) => ({
  id,
  to_gender: 'female',
  before: { name: `Customer ${id}`, phone: null, phone_normalized: null, membership_number: null, is_anonymous: 0, address: null, updated_at: '2026-09-12', gender: null },
  match: { kind: 'unique_phone', key: `0${id}` },
})
let nextId = 1
const chunks = Array.from({ length: CUSTOMER_GENDER_RESTORATION_CHUNKS }, (_, chunk_index) => {
  const count = chunk_index === CUSTOMER_GENDER_RESTORATION_CHUNKS - 1 ? 12 : 50
  return {
    version: 1,
    campaign_id: CUSTOMER_GENDER_RESTORATION_CAMPAIGN,
    chunk_index,
    chunk_digest: `sha256-${String(chunk_index).padStart(64, '0')}`,
    rows: Array.from({ length: count }, () => row(nextId++)),
  }
})
const file = { version: 1, campaign_id: CUSTOMER_GENDER_RESTORATION_CAMPAIGN, total_count: CUSTOMER_GENDER_RESTORATION_TOTAL, chunks }
assert.equal(parseCustomerGenderRestorationFile(JSON.stringify(file)).chunks.length, 84)
assert.throws(() => parseCustomerGenderRestorationFile('{broken'), /valid JSON/)
assert.throws(() => parseCustomerGenderRestorationFile(JSON.stringify({ ...file, total_count: 4161 })), /not approved/)
assert.throws(() => parseCustomerGenderRestorationFile(JSON.stringify({ ...file, chunks: [...chunks.slice(0, 83), chunks[0]] })), /malformed or duplicated/)
const generalChunks = structuredClone(chunks)
generalChunks[0].rows[0].before.name = 'General'
assert.throws(() => parseCustomerGenderRestorationFile(JSON.stringify({ ...file, chunks: generalChunks })), /malformed or duplicated/)

const chunk = chunks[0] as GenderRestorationChunk
const receipt = (status: GenderRestorationReceipt['status']): GenderRestorationReceipt => ({ operation_id: 'op', chunk_index: 0, count: 50, status, generation: 0, history_id: status === 'ready' ? null : 42 })
const status = (receipts: GenderRestorationReceipt[] = []): GenderRestorationStatus => ({ success: true, campaign_id: CUSTOMER_GENDER_RESTORATION_CAMPAIGN, total_count: 4162, chunk_count: 84, receipts })

const first79 = chunks.slice(0, 79).map((item) => ({ ...receipt('applied'), operation_id: `op-${item.chunk_index}`, chunk_index: item.chunk_index, count: item.rows.length }))
const remainingAfterLive79 = remainingGenderRestorationChunks(file as GenderRestorationFile, status(first79))
assert.deepEqual(remainingAfterLive79.map((item) => item.chunk_index), [79, 80, 81, 82, 83])
assert.equal(remainingAfterLive79.reduce((sum, item) => sum + item.rows.length, 0), 212, 'status recovery submits only the 212 records not covered by 79 applied receipts')

// Actual callback sequencing: an A -> B -> A authority transition after the
// preview invalidates the generation and must never dispatch apply.
let authority = 'actor-A-session-0'
const expectedAuthority = authority
let resolvePreview!: (value: GenderRestorationReceipt) => void
let applyCalls = 0
const staleRun = executeCustomerGenderRestorationChunk({
  chunk,
  isCurrent: () => authority === expectedAuthority,
  preview: () => new Promise((resolve) => { resolvePreview = resolve }),
  apply: async () => { applyCalls++; return receipt('applied') },
  status: async () => status(),
})
authority = 'actor-B-session-1'
authority = 'actor-A-session-2'
resolvePreview(receipt('ready'))
assert.deepEqual(await staleRun, { kind: 'stale' })
assert.equal(applyCalls, 0)

// Unknown outcome performs status only. A missing receipt never auto-replays;
// a second, explicit invocation may resend the same approved chunk.
let attempts = 0
const callbacks = {
  chunk,
  isCurrent: () => true,
  preview: async () => receipt('ready'),
  apply: async () => {
    attempts++
    if (attempts === 1) throw Object.assign(new Error('lost reply'), { outcome: 'unknown' })
    return receipt('applied')
  },
  status: async () => status(),
}
assert.equal((await executeCustomerGenderRestorationChunk(callbacks)).kind, 'unknown')
assert.equal(attempts, 1)
assert.equal((await executeCustomerGenderRestorationChunk(callbacks)).kind, 'applied')
assert.equal(attempts, 2)

const knownCommit = await executeCustomerGenderRestorationChunk({
  ...callbacks,
  apply: async () => { throw Object.assign(new Error('lost reply'), { status: 503 }) },
  status: async () => status([receipt('applied')]),
})
assert.equal(knownCommit.kind, 'applied', 'an actor-owned durable receipt resolves a lost reply without replay')

let refusedApply = 0
let refusedStatus = 0
const conflict = await executeCustomerGenderRestorationChunk({
  ...callbacks,
  preview: async () => { throw Object.assign(new Error('identity changed'), { status: 409 }) },
  apply: async () => { refusedApply++; return receipt('applied') },
  status: async () => { refusedStatus++; return status() },
})
assert.equal(conflict.kind, 'failed')
assert.equal(refusedApply, 0)
assert.equal(refusedStatus, 0, 'an authoritative conflict stops instead of entering unknown recovery')

const reversed = await executeCustomerGenderRestorationChunk({ ...callbacks, preview: async () => receipt('reversed') })
assert.equal(reversed.kind, 'failed', 'an undone receipt must be redone through Records, never reapplied')

const gate = { current: false }
assert.equal(claimGenderRestorationAction(gate), true)
assert.equal(claimGenderRestorationAction(gate), false, 'a second quick click cannot enter the callback')
releaseGenderRestorationAction(gate)
assert.equal(claimGenderRestorationAction(gate), true)

// This is the exact effect callback mounted by the modal. React StrictMode
// runs setup -> cleanup -> setup; the second setup must revive async work.
const alive = { current: false }
const lifecycleGeneration = { current: 0 }
const firstCleanup = activateGenderRestorationLifecycle(alive, lifecycleGeneration)
assert.equal(alive.current, true)
firstCleanup()
assert.equal(alive.current, false)
assert.equal(lifecycleGeneration.current, 1)
const secondCleanup = activateGenderRestorationLifecycle(alive, lifecycleGeneration)
assert.equal(alive.current, true, 'StrictMode remount remains live')
secondCleanup()

const customers = readFileSync(new URL('../src/components/contacts/CustomersTab.tsx', import.meta.url), 'utf8')
const modal = readFileSync(new URL('../src/components/contacts/CustomerGenderRestorationModal.tsx', import.meta.url), 'utf8').replace(/\r\n?/g, '\n')
const transport = readFileSync(new URL('../src/api/contactWriteTransport.ts', import.meta.url), 'utf8')
const actionHistory = readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const replayHelper = actionHistory.match(/export function buildServerReplayRequest[\s\S]*?\r?\n}\r?\n/)?.[0]
assert.ok(replayHelper)
const buildServerReplayRequest = new Function(`${stripTypeScriptTypes(replayHelper.replace('export ', ''))}; return buildServerReplayRequest`)() as (payload: Record<string, unknown>) => Record<string, unknown>
assert.deepEqual(buildServerReplayRequest({ applier: 'customer.gender_restore', generation: 3 }), { require_applied: true, expected_generation: 3 })
assert.deepEqual(buildServerReplayRequest({ applier: 'customer.gender_restore' }), { require_applied: true }, 'missing provenance is not invented client-side')
assert.match(customers, /permission\.isAdmin[\s\S]*permission\.getPermissionTier\('contacts'\) === 'full'[\s\S]*permission\.can\('contacts', 'edit'\)/)
assert.match(customers, /canRestoreCustomerGenderRef\.current[\s\S]*setModal\('gender-restoration'\)/)
assert.match(modal, /type="file"[\s\S]*accept="\.json,application\/json"/)
assert.match(modal, /executeCustomerGenderRestorationChunk\([\s\S]*preview: api\.previewCustomerGenderRestoration[\s\S]*apply: api\.applyCustomerGenderRestoration/)
assert.match(modal, /isActorReadScopeCurrent\(scope, false\)/)
assert.match(modal, /const scopeCurrent = isActorReadScopeCurrent\(openedScopeRef\.current, false\)/)
assert.match(modal, /if \(scopeCurrent\) return[^]*?operationGenerationRef\.current \+= 1[^]*?setManifest\(null\)[^]*?setStatus\(null\)[^]*?setConfirmed\(false\)/, 'same-user authority refresh fences callbacks and clears private state')
assert.match(modal, /if \(!scopeCurrent\) \{[^]*?customer_gender_restore_session_refreshed[^]*?onClick=\{onClose\}/, 'stale scope stays visibly closable instead of returning an invisible mounted modal')
const extractStaleView = (source: string): string => {
  const normalized = source.replace(/\r\n?/g, '\n')
  const start = normalized.indexOf('if (!scopeCurrent) {')
  const end = normalized.indexOf('\n\n  return (', start)
  assert.ok(start >= 0 && end > start, 'stale-only render branch has stable boundaries')
  return normalized.slice(start, end)
}
const staleView = extractStaleView(modal)
assert.equal(extractStaleView(modal.replace(/\n/g, '\r\n')), staleView, 'CRLF source isolates the same stale-only branch')
assert.doesNotMatch(staleView, /loadTransport|refreshStatus|applyAll|previewCustomerGenderRestoration|applyCustomerGenderRestoration/, 'stale rendering never performs a recovery read or write automatically')
assert.doesNotMatch(modal, /localStorage|sessionStorage|console\.|\.rows\.map\(/, 'manifest PII is neither persisted, logged, nor rendered')
assert.match(transport, /apiFetch\('POST', '\/api\/customers\/gender-restoration\/preview'/)
assert.match(transport, /apiFetch\('POST', '\/api\/customers\/gender-restoration\/apply'/)
assert.match(transport, /apiFetch\('GET', `\/api\/customers\/gender-restoration\/status\?\$\{query\.toString\(\)\}`/)

console.log('PASS customer gender restoration file, authority, retry, double-click, and transport contracts')
