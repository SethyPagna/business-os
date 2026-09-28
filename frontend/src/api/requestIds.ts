export type RequestPayload = Record<string, unknown>

export function createClientRequestId(prefix = 'req'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function ensureClientRequestId<TPayload extends RequestPayload | null | undefined>(
  payload: TPayload,
  prefix = 'req',
): RequestPayload {
  const source: RequestPayload = payload || {}
  const current = String(source.client_request_id || '').trim()
  if (current) return { ...source, client_request_id: current.slice(0, 120) }
  return { ...source, client_request_id: createClientRequestId(prefix) }
}
