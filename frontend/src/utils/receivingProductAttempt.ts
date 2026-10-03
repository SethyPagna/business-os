import { assertActorSessionDispatchAllowed, captureActorReadScope } from '../api/actorReadScope.ts'
import { getSyncServerUrl } from '../api/httpState.ts'
import { authenticatedOrganizationId } from '../api/offlineQueueOwnership.ts'
import type { ReceivingSubmissions } from './receivingDestination.ts'
import type { StockSessionLine } from './stockSessionDraft.ts'

type AttemptState = 'prepared' | 'attempting' | 'not_dispatched' | 'unknown' | 'pending' | 'confirmed'
type AttemptIdentity = { actor: number; organization: number | null; origin: string; server: string; session: string; requestId: string }
export type ReceivingProductAttempt = AttemptIdentity & {
  version: 1; state: AttemptState; owner: string | null; bodyJson: string | null; productId: number | null
}
const PREFIX = 'businessos_receiving_product_attempt_v1:'
const MAX_BYTES = 128 * 1024
const failure = (code = 'receiving_submission_not_saved') => Object.assign(new Error(code), { code })
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function identity(actorId: unknown, requestId: unknown): AttemptIdentity {
  assertActorSessionDispatchAllowed()
  try {
    if (!positiveId(Number(actorId)) || typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(requestId)) throw failure()
    const user = JSON.parse(window.sessionStorage.getItem('businessos_user') || window.localStorage.getItem('businessos_user') || 'null')
    if (!user || Number(user.id) !== Number(actorId)) throw failure('receiving_submission_locked')
    const origin = window.location.origin
    const server = new URL(getSyncServerUrl() || origin, origin)
    if (!/^https?:$/.test(server.protocol) || server.username || server.password || server.search || server.hash) throw failure()
    const session = window.localStorage.getItem('businessos_read_session')
    if (!session || session.length > 256) throw failure('receiving_submission_locked')
    return { actor: Number(actorId), organization: authenticatedOrganizationId(user), origin, server: server.href.replace(/\/$/, ''), session, requestId }
  } catch (error) {
    if ((error as { code?: string })?.code) throw error
    throw failure()
  }
}

function keyOf(value: AttemptIdentity): string {
  return PREFIX + encodeURIComponent(JSON.stringify([value.origin, value.server, value.requestId]))
}

function sameIdentity(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return a.actor === b.actor && a.organization === b.organization && a.origin === b.origin && a.server === b.server
    && a.session === b.session && a.requestId === b.requestId
}

function read(current: AttemptIdentity): ReceivingProductAttempt | null {
  try {
    const raw = window.localStorage.getItem(keyOf(current))
    if (raw === null) return null
    if (new TextEncoder().encode(raw).length > MAX_BYTES) throw failure()
    const saved = JSON.parse(raw) as ReceivingProductAttempt
    if (!saved || Object.keys(saved).sort().join() !== 'actor,bodyJson,organization,origin,owner,productId,requestId,server,session,state,version'
      || saved.version !== 1 || !sameIdentity(saved, current)
      || !['prepared', 'attempting', 'not_dispatched', 'unknown', 'pending', 'confirmed'].includes(saved.state)) throw failure()
    if (saved.state === 'prepared') {
      if (saved.owner !== null || saved.bodyJson !== null || saved.productId !== null) throw failure()
    } else {
      if (typeof saved.owner !== 'string' || !/^[0-9a-f-]{36}$/.test(saved.owner) || typeof saved.bodyJson !== 'string') throw failure()
      const body = JSON.parse(saved.bodyJson)
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.client_request_id !== current.requestId
        || Number(body.userId) !== current.actor || body.stock_quantity !== 0) throw failure()
      if (saved.state === 'confirmed' ? !positiveId(saved.productId) : saved.productId !== null) throw failure()
    }
    return saved
  } catch { throw failure('product_create_outcome_unknown') }
}

function write(current: AttemptIdentity, value: ReceivingProductAttempt): void {
  try {
    const raw = JSON.stringify(value)
    if (new TextEncoder().encode(raw).length > MAX_BYTES) throw failure()
    window.localStorage.setItem(keyOf(current), raw)
    if (window.localStorage.getItem(keyOf(current)) !== raw) throw failure()
  } catch { throw failure() }
}

async function locked<T>(current: AttemptIdentity, action: () => T): Promise<T> {
  const scope = captureActorReadScope('receiving-product-attempt')
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw failure()
  return navigator.locks.request(keyOf(current), { mode: 'exclusive' }, () => {
    assertActorSessionDispatchAllowed(scope)
    if (!sameIdentity(current, identity(current.actor, current.requestId))) throw failure('receiving_submission_locked')
    return action()
  })
}

export function readReceivingProductAttempt(actorId: unknown, requestId: unknown): ReceivingProductAttempt | null {
  return read(identity(actorId, requestId))
}

export async function registerReceivingProductAttempt(actorId: unknown, requestId: string): Promise<void> {
  const current = identity(actorId, requestId)
  await locked(current, () => {
    if (read(current)) throw failure('product_create_outcome_unknown')
    write(current, { ...current, version: 1, state: 'prepared', owner: null, bodyJson: null, productId: null })
  })
}

export async function reserveReceivingProductAttempt(actorId: unknown, requestId: unknown, payload: Record<string, unknown>, validate: () => void): Promise<ReceivingProductAttempt> {
  const current = identity(actorId, requestId)
  const bodyJson = JSON.stringify(payload)
  if (!bodyJson || payload.client_request_id !== current.requestId || Number(payload.userId) !== current.actor || payload.stock_quantity !== 0) throw failure()
  return locked(current, () => {
    const saved = read(current)
    if (!saved || !['prepared', 'not_dispatched'].includes(saved.state)) throw failure(saved?.state === 'pending' ? 'product_pending_review' : 'product_create_outcome_unknown')
    if (saved.bodyJson !== null && saved.bodyJson !== bodyJson) throw failure('receiving_submission_locked')
    validate()
    const attempt: ReceivingProductAttempt = { ...saved, state: 'attempting', owner: crypto.randomUUID(), bodyJson }
    write(current, attempt)
    return attempt
  })
}

export function assertReceivingProductAttemptDispatch(attempt: ReceivingProductAttempt): void {
  const current = identity(attempt.actor, attempt.requestId)
  if (!sameIdentity(current, attempt)) throw failure('receiving_submission_locked')
  const saved = read(current)
  if (!saved || saved.state !== 'attempting' || saved.owner !== attempt.owner || saved.bodyJson !== attempt.bodyJson) throw failure('product_create_outcome_unknown')
}

export async function finishReceivingProductAttempt(attempt: ReceivingProductAttempt, state: 'not_dispatched' | 'unknown' | 'pending' | 'confirmed', productId: number | null = null): Promise<void> {
  if (state === 'confirmed' ? !positiveId(productId) : productId !== null) throw failure()
  await locked(attempt, () => {
    const saved = read(attempt)
    if (!saved || saved.state !== 'attempting' || saved.owner !== attempt.owner || saved.bodyJson !== attempt.bodyJson) throw failure('product_create_outcome_unknown')
    write(attempt, { ...saved, state, productId })
  })
}

export function overlayReceivingProductAttempts(actorId: unknown, state: ReceivingSubmissions, lines: readonly StockSessionLine[]): void {
  for (const line of lines) {
    if (!line.createPayload || Number(line.product.id) > 0) continue
    try {
      const saved = readReceivingProductAttempt(actorId, line.createRequestId)
      if (!saved) throw failure()
      state.unknown = state.unknown.filter(key => key !== line.key)
      if (saved.bodyJson !== null) state.products[line.key] = JSON.parse(saved.bodyJson) as Record<string, unknown>
      else delete state.products[line.key]
      state.productOutcomes[line.key] = saved.state === 'pending' ? 'pending'
        : saved.state === 'prepared' || saved.state === 'not_dispatched' ? 'not_sent' : 'unknown'
      if (state.productOutcomes[line.key] === 'unknown' && !state.unknown.includes(line.key)) state.unknown.push(line.key)
    } catch {
      state.productOutcomes[line.key] = 'unknown'
      if (!state.unknown.includes(line.key)) state.unknown.push(line.key)
    }
  }
}
