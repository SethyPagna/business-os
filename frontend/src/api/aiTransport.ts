import { apiFetch, route } from './http.ts'
import { appendActorQuery } from './actorQuery.ts'

type AiPayload = Record<string, unknown>

export function getAiProviders(): Promise<unknown> {
  return route(
    'ai:providers:get',
    () => apiFetch('GET', appendActorQuery('/api/ai/providers')),
    () => ({ items: [], providerMeta: {} }),
  )
}

export function createAiProvider(payload: AiPayload = {}): Promise<unknown> {
  return route('ai:providers:create', () => apiFetch('POST', '/api/ai/providers', payload || {}), null, true)
}

export function updateAiProvider(id: string | number, payload: AiPayload = {}): Promise<unknown> {
  return route('ai:providers:update', () => apiFetch('PUT', `/api/ai/providers/${id}`, payload || {}), null, true)
}

export function deleteAiProvider(id: string | number, payload: AiPayload = {}): Promise<unknown> {
  return route('ai:providers:delete', () => apiFetch('DELETE', `/api/ai/providers/${id}`, payload || {}), null, true)
}

export function testAiProvider(id: string | number, payload: AiPayload = {}): Promise<unknown> {
  return route('ai:providers:test', () => apiFetch('POST', `/api/ai/providers/${id}/test`, payload || {}), null, true)
}

export function getAiResponses(limit = 80): Promise<unknown> {
  return route(
    `ai:responses:${limit}`,
    () => apiFetch('GET', appendActorQuery(`/api/ai/responses?limit=${limit}`)),
    () => ({ items: [] }),
  )
}
