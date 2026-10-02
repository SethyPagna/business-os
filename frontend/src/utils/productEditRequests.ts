import { createClientRequestId } from '../api/requestIds.ts'
import { getSyncServerUrl } from '../api/httpState.ts'
import { STORAGE_KEYS } from '../constants.ts'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Body = Record<string, unknown>
export type ProductEditIntent = { productId: string; body: Body; attempt?: number }
export type ProductEditReplayIntent = { serverId: string | number; operationId: string; direction: 'undo' | 'redo'; generation: number; attempt?: number }
export type ProductEditHistory = { id: string | number; undo_payload: Body; redo_payload: Body; [key: string]: unknown }

function requestError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export async function localizeProductEditError(error: unknown): Promise<unknown> {
  const candidate = error as { code?: string; message?: string }
  const aliases: Record<string, string> = {
    product_cost_edit_required: 'product_edit_cost_permission_required',
    product_image_edit_required: 'product_edit_image_permission_required',
    invalid_client_request_id: 'product_edit_request_invalid',
    idempotency_conflict: 'product_edit_request_immutable',
    request_permission_revoked: 'product_edit_permission_required',
    review_state_conflict: 'product_edit_state_conflict',
  }
  const key = aliases[candidate?.code || ''] || (candidate?.code?.startsWith('product_edit_') ? candidate.code : '')
  if (!key) return error
  try {
    const language = typeof document === 'undefined' ? '' : document.documentElement?.getAttribute('lang') || ''
    const pack = (language.startsWith('km') ? (await import('../lang/km.json')).default : (await import('../lang/en.json')).default) as Record<string, unknown>
    if (typeof pack[key] === 'string') candidate.message = String(pack[key])
  } catch {}
  return error
}

export function productEditStorageKey(kind: string): string {
  const raw = sessionStorage.getItem(STORAGE_KEYS.USER) || localStorage.getItem(STORAGE_KEYS.USER)
  const user = raw ? JSON.parse(raw) as Body : null
  if (!user?.id) throw requestError('product_edit_actor_unavailable', 'Sign in again before saving this product.')
  const identity = [getSyncServerUrl(), window.location.origin, user.organization_public_id ?? user.organizationId ?? user.organization_id ?? '', String(user.id)]
  return `product_edit:v1:${encodeURIComponent(JSON.stringify(identity))}:${kind}`
}

function read<T>(storage: Store, key: string): T | null {
  try {
    const raw = storage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch { throw requestError('product_edit_retry_invalid', 'The saved product request cannot be read. Keep this tab open and contact an administrator.') }
}

function persist(storage: Store, key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  try {
    storage.setItem(key, raw)
    if (storage.getItem(key) === raw) return
  } catch {}
  throw requestError('product_edit_retry_unavailable', 'The retry could not be saved. No new request was sent.')
}

function definiteRefusal(error: unknown): boolean {
  const refusal = error as { status?: number; code?: string; transientGateway?: boolean; outcome?: string }
  return refusal.outcome === 'not_dispatched' || (!!refusal.status && refusal.status >= 400 && refusal.status < 500
    && ![408, 425, 429].includes(refusal.status) && !refusal.transientGateway && refusal.code !== 'edge_interference')
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => (value as Body)[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical((value as Body)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function editFields(body: Body): Body {
  const result = { ...body }
  for (const key of ['client_request_id', 'expectedUpdatedAt', 'expected_updated_at', 'updated_at', 'userId', 'userName', 'clientTime', 'deviceTz', 'deviceId', 'deviceName', 'deviceType', 'device_name', 'device_id', 'device_type']) delete result[key]
  return result
}

export function readProductEditIntents(storage: Store, key: string): ProductEditIntent[] {
  const value = read<Record<string, ProductEditIntent>>(storage, key) || {}
  return Object.values(value)
}

export async function executeProductEditRequest(
  storage: Store, key: string, productId: string | number, body: Body,
  send: (intent: ProductEditIntent) => Promise<unknown>, assertCurrent: () => void,
): Promise<unknown> {
  assertCurrent()
  const id = String(productId)
  if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) throw requestError('product_edit_retry_invalid', 'The product identity is invalid.')
  const requests = read<Record<string, ProductEditIntent>>(storage, key) || {}
  const previous = requests[id]
  if (previous && (previous.productId !== id || canonical(editFields(previous.body)) !== canonical(editFields(body)))) {
    throw requestError('product_edit_pending', 'Check the pending product save before making another change.')
  }
  const intent = {
    ...(previous || { productId: id, body: { ...body, client_request_id: String(body.client_request_id || createClientRequestId('product_edit')) } }),
    attempt: previous ? Number(previous.attempt || 1) + 1 : 1,
  }
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(String(intent.body.client_request_id || ''))) throw requestError('product_edit_retry_invalid', 'The saved product request identity is invalid.')
  persist(storage, key, { ...requests, [id]: intent })
  const clear = (firstRefusal = false) => {
    assertCurrent()
    const current = read<Record<string, ProductEditIntent>>(storage, key) || {}
    if (current[id]?.body.client_request_id !== intent.body.client_request_id) return
    if (firstRefusal && current[id]?.attempt !== intent.attempt) return
    delete current[id]
    if (Object.keys(current).length) persist(storage, key, current)
    else storage.removeItem(key)
  }
  try {
    assertCurrent()
    const result = await send(intent)
    assertCurrent()
    const response = result as { success?: boolean; applied?: boolean; pending?: boolean } | null
    if (!response || response.success === false || (!productEditPendingReceipt(result) && !productEditHistoryReceipt(result))) {
      throw requestError('product_edit_outcome_unknown', 'The product save is not confirmed. Check the pending save before retrying.')
    }
    clear()
    return result
  } catch (error) {
    if (!previous && definiteRefusal(error)) clear(true)
    throw error
  }
}

export async function executeProductEditReplay(
  storage: Store, key: string, requested: ProductEditReplayIntent,
  send: (intent: ProductEditReplayIntent, body: { require_applied: true; expected_generation: number }) => Promise<unknown>,
  assertCurrent: () => void,
): Promise<unknown> {
  assertCurrent()
  const previous = read<ProductEditReplayIntent>(storage, key)
  const pending = { ...(previous || requested), attempt: previous ? Number(previous.attempt || 1) + 1 : 1 }
  if (String(pending.serverId) !== String(requested.serverId) || pending.operationId !== requested.operationId) throw requestError('product_edit_replay_pending', 'Check the pending Product Undo or Redo first.')
  if (!pending.operationId || !Number.isSafeInteger(pending.generation) || pending.generation < 0 || !['undo', 'redo'].includes(pending.direction)) throw requestError('product_edit_retry_invalid', 'The saved Product Undo request is invalid.')
  persist(storage, key, pending)
  try {
    assertCurrent()
    const result = await send(pending, { require_applied: true, expected_generation: pending.generation })
    assertCurrent()
    const response = result as Body | null
    if (productEditPendingReceipt(result) && String(response?.operation_id) === pending.operationId && response?.generation === pending.generation) return result
    const currentGeneration = response?.current_generation
    const receipt = response && productEditHistoryReceipt({ ...response, generation: currentGeneration, history: response.item })
    if (!receipt || String(response?.action_history_id) !== String(pending.serverId) || String(response?.operation_id) !== pending.operationId
      || response?.generation !== pending.generation + 1 || Number(currentGeneration) < Number(response?.generation)) {
      throw requestError('product_edit_outcome_unknown', 'Product Undo or Redo is not confirmed. Retry the pending action.')
    }
    storage.removeItem(key)
    return { ...response, reconciled_direction: pending.direction }
  } catch (error) {
    if (!previous && definiteRefusal(error)) {
      assertCurrent()
      if (read<ProductEditReplayIntent>(storage, key)?.attempt === pending.attempt) storage.removeItem(key)
    }
    throw error
  }
}

export function productEditHistoryReceipt(result: unknown): ProductEditHistory | null {
  if (!result || typeof result !== 'object') return null
  const response = result as Body
  if (response.applied !== true || response.pending === true) return null
  const history = response.history as ProductEditHistory | undefined
  if (!history?.id || String(history.id) !== String(response.action_history_id)) return null
  for (const payload of [history.undo_payload, history.redo_payload]) {
    if (payload?.applier !== 'product.edit.v1' || String(payload.operation_id) !== String(response.operation_id)
      || !Number.isSafeInteger(payload.generation) || payload.generation !== response.generation) return null
  }
  return history
}

export function productEditPendingReceipt(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const response = result as Body
  return response.pending === true && response.applied === false && Number.isSafeInteger(response.pendingActionId)
    && Number(response.pendingActionId) > 0 && /^[1-9][0-9]*$/.test(String(response.operation_id || ''))
    && Number.isSafeInteger(response.generation) && Number(response.generation) >= 0
}
