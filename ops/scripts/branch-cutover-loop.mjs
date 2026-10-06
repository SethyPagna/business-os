// The operator loop of the branch cutover, shared by ops/scripts/ops-branch-cutover.mjs (production, over HTTPS) and
// cloudflare/scripts/test-branch-cutover-operator-native.cjs (the same loop against the real endpoint). No I/O of its
// own: `send(action, bodyText)` returns { status, json } or throws (a timeout, a reset connection, a lost response).
//
// Idempotence rules, all enforced here:
//   - A request body is serialised ONCE per logical call and the identical text is sent again on every retry, so the
//     request id and the expected revision can never change after an unknown outcome.
//   - A step's request id is a pure function of the operation id and the revision it was issued at (stepRequestId).
//   - Retried: a thrown send (timeout, reset), HTTP 429 / 5xx and the endpoint's own `retryable` code (a D1 7429
//     CPU-limit reset, an unconfirmed batch). Never retried: 401, 404 (endpoint disabled), and every 4xx refusal; the
//     loop stops on the first of those with a fixed code, and the maintenance fence stays held for the operator.
//   - After an unknown outcome the next response says `replayed` (the step had committed) or does the step now;
//     either way the revision it returns is the only state the loop trusts.

import { OpsError } from './ops-common.mjs'

export const STEP_LIMIT = 60000
export const MAX_ATTEMPTS = 25
// Begin has no journal row yet, so a failed begin batch cannot be told from a lost acknowledgement: a few identical retries, then stop.
export const BEGIN_ATTEMPTS = 4
export const OPERATION_PHASES = Object.freeze(['none', 'capturing', 'snapshots', 'moving', 'verifying', 'ready', 'completed', 'aborted'])
export const NEXT_STATES = Object.freeze(['none', 'continue', 'child', 'ready', 'completed', 'aborted'])
const REFUSAL = /^[a-z][a-z0-9_]{2,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const stepRequestId = (operationId, revision) => `bcr_${operationId}_${revision}`

const backoffMs = (attempt) => Math.min(15000, 500 * 2 ** Math.min(attempt - 1, 10))

export function refusalCode(json) {
  const code = json && typeof json.refusal === 'string' && REFUSAL.test(json.refusal) ? json.refusal : 'refused'
  return new OpsError(`refused-${code.replaceAll('_', '-')}`.slice(0, 64), `The endpoint refused: ${code}`, { detail: json && json.detail })
}

export function createClient({ send, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxAttempts = MAX_ATTEMPTS }) {
  const stats = { calls: 0, attempts: 0, retries: 0, transport: 0, serverBusy: 0, retryable: 0, replayed: 0 }
  async function call(action, body = {}) {
    const text = JSON.stringify(body)
    stats.calls += 1
    for (let attempt = 1; ; attempt += 1) {
      stats.attempts += 1
      let response = null
      let transient = null
      try {
        response = await send(action, text)
      } catch {
        transient = 'transport'
      }
      if (response) {
        const json = response.json && typeof response.json === 'object' ? response.json : {}
        if (response.status === 200 && json.ok === true) {
          if (json.replayed === true) stats.replayed += 1
          return json
        }
        if (response.status === 401) throw new OpsError('unauthorized', 'The operator token was refused.')
        if (response.status === 404) throw new OpsError('endpoint-disabled', 'The endpoint is not enabled on this Worker.')
        if (json.code === 'retryable') transient = 'retryable'
        else if (response.status === 429 || response.status >= 500) transient = 'serverBusy'
        else throw refusalCode(json)
      }
      stats[transient] += 1
      if (attempt >= (action === 'begin' ? Math.min(BEGIN_ATTEMPTS, maxAttempts) : maxAttempts)) {
        throw new OpsError(action === 'begin' ? 'begin-not-confirmed' : 'retries-exhausted', `The call ${action} did not settle after ${attempt} attempts.`)
      }
      stats.retries += 1
      await sleep(backoffMs(attempt))
    }
  }
  return { call, stats }
}

function phaseOf(state) {
  if (!state || !OPERATION_PHASES.includes(state.phase) || !NEXT_STATES.includes(state.next) || !Number.isSafeInteger(state.revision)) {
    throw new OpsError('unexpected-response', 'The endpoint answered with a state this runner does not know.')
  }
  return state
}

export async function readStatus(client, operationId) {
  const state = phaseOf(await client.call('status', operationId ? { operationId } : {}))
  if (!operationId && state.phase === 'none') throw new OpsError('no-operation', 'There is no cutover operation on this database.')
  if (state.operationId && !UUID.test(state.operationId)) throw new OpsError('unexpected-response', 'Bad operation id.')
  return state
}

export function inspectVerdict(inspect) {
  const capabilities = Array.isArray(inspect && inspect.capabilities) ? inspect.capabilities : []
  const codes = [...new Set(capabilities.map((entry) => (entry && typeof entry.code === 'string' && REFUSAL.test(entry.code) ? entry.code : 'other')))].sort()
  return { ready: Boolean(inspect && inspect.activationReady === true && capabilities.length === 0), capabilityCodes: codes }
}

export async function inspectCutover(client, { actorUserId }) {
  const response = await client.call('inspect', { actorUserId })
  return { inspect: response.inspect, verdict: inspectVerdict(response.inspect) }
}

/** P6: inspect, then begin with the values inspect returned; the begin request id is fixed by the caller so a re-run replays. */
export async function startCutover(client, { actorUserId, requestId }) {
  const { inspect, verdict } = await inspectCutover(client, { actorUserId })
  if (!verdict.ready) throw new OpsError('inspect-not-ready', 'Inspect reports capabilities that block a cutover.', { capabilities: inspect.capabilities })
  const state = phaseOf(await client.call('begin', { actorUserId, requestId, expectedSourceJson: inspect.sourcePreimageJson,
    expectedTargetJson: inspect.targetPreimageJson, expectedSchemaDigest: inspect.schemaDigest }))
  return { inspect, state }
}

/** P8: one resume call per durable step until the journal says ready. The revision must move forward on every call. */
export async function resumeUntilReady(client, { operationId, now = Date.now, deadline = Infinity, stepLimit = STEP_LIMIT, onStep = () => {} }) {
  let state = await readStatus(client, operationId)
  const id = state.operationId
  let steps = 0
  while (state.next === 'continue' || state.next === 'child') {
    if (now() >= deadline) throw new OpsError('time-budget-reached', 'The time budget ended; resume the same operation.')
    if (steps >= stepLimit) throw new OpsError('step-limit-reached', 'The step limit ended the loop; resume the same operation.')
    const before = state
    state = phaseOf(await client.call('resume', { operationId: id, expectedRevision: before.revision, requestId: stepRequestId(id, before.revision) }))
    steps += 1
    if (state.operationId !== id || state.revision <= before.revision) throw new OpsError('no-progress', 'A step did not advance the journal.')
    await onStep({ steps, before, state })
  }
  if (state.next === 'aborted') throw new OpsError('operation-aborted', 'The operation was aborted.')
  return { state, steps }
}

export async function finalizeCutover(client, { operationId }) {
  const state = await readStatus(client, operationId)
  if (state.next === 'completed') return { state, replayed: true }
  if (state.next !== 'ready') throw new OpsError('not-ready', 'The operation is not ready to finalize.')
  const done = phaseOf(await client.call('finalize', { operationId: state.operationId, expectedRevision: state.revision, requestId: stepRequestId(state.operationId, state.revision) }))
  if (done.next !== 'completed') throw new OpsError('finalize-incomplete', 'Finalize did not complete the operation.')
  return { state: done, replayed: done.replayed === true }
}

export async function abortCutover(client, { operationId }) {
  const state = await readStatus(client, operationId)
  if (state.next === 'aborted') return { state, replayed: true }
  const done = phaseOf(await client.call('abort', { operationId: state.operationId, expectedRevision: state.revision, requestId: stepRequestId(state.operationId, state.revision) }))
  if (done.next !== 'aborted') throw new OpsError('abort-incomplete', 'Abort did not end the operation.')
  return { state: done, replayed: done.replayed === true }
}
