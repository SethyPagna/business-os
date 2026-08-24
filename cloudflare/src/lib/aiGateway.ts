// Ported from backend/src/services/aiGateway.ts. Logic is kept 1:1 with the
// Node version; only the secret encryption calls became async (Web Crypto)
// and providerConfig.api_key_encrypted decryption now needs the env's
// APP_ENCRYPTION_KEY passed through explicitly (no module-level env access
// in a Worker).
import { decryptSecret, maskApiKey } from './secretCrypto'
import { assertSafeOutboundUrl } from './netSecurity'

function trim(value: unknown): string {
  return String(value || '').trim()
}

export function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T
  } catch (_) {
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeTextList(value: unknown, separator = '\n'): string[] {
  const source = Array.isArray(value) ? value : String(value || '').split(separator)
  const items: string[] = []
  for (const entry of source) {
    const item = trim(entry)
    if (item) items.push(item)
  }
  return items
}

export type ProviderMeta = {
  label: string
  supportedTypes: string[]
  defaultEndpoint: string
  defaultModel: string
  defaultPriority: number
  safeRequestsPerMinute: number
  safeMaxInputChars: number
  safeMaxCompletionTokens: number
  safeTimeoutMs: number
  safeCooldownSeconds: number
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  groq: {
    label: 'Groq',
    supportedTypes: ['chat'],
    defaultEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'groq/compound',
    defaultPriority: 10,
    safeRequestsPerMinute: 18,
    safeMaxInputChars: 1200,
    safeMaxCompletionTokens: 1800,
    safeTimeoutMs: 18000,
    safeCooldownSeconds: 20,
  },
  mistral: {
    label: 'Mistral AI',
    supportedTypes: ['chat'],
    defaultEndpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-small-latest',
    defaultPriority: 30,
    safeRequestsPerMinute: 10,
    safeMaxInputChars: 1100,
    safeMaxCompletionTokens: 1400,
    safeTimeoutMs: 18000,
    safeCooldownSeconds: 25,
  },
  cerebras: {
    label: 'Cerebras',
    supportedTypes: ['chat'],
    defaultEndpoint: 'https://api.cerebras.ai/v1/chat/completions',
    defaultModel: 'llama3.1-8b',
    defaultPriority: 40,
    safeRequestsPerMinute: 12,
    safeMaxInputChars: 900,
    safeMaxCompletionTokens: 1200,
    safeTimeoutMs: 14000,
    safeCooldownSeconds: 25,
  },
  google: {
    label: 'Google AI',
    supportedTypes: ['chat'],
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-flash-latest',
    defaultPriority: 20,
    safeRequestsPerMinute: 14,
    safeMaxInputChars: 1200,
    safeMaxCompletionTokens: 1600,
    safeTimeoutMs: 17000,
    safeCooldownSeconds: 20,
  },
  cohere: {
    label: 'Cohere',
    supportedTypes: ['embed'],
    defaultEndpoint: 'https://api.cohere.com/v2/embed',
    defaultModel: 'embed-english-v3.0',
    defaultPriority: 90,
    safeRequestsPerMinute: 20,
    safeMaxInputChars: 1000,
    safeMaxCompletionTokens: 0,
    safeTimeoutMs: 12000,
    safeCooldownSeconds: 20,
  },
}

export function getProviderMeta(providerKey: unknown): ProviderMeta | null {
  return PROVIDER_META[trim(providerKey).toLowerCase()] || null
}

export function normalizeProviderPayload(payload: Record<string, unknown> = {}) {
  const provider = trim(payload.provider).toLowerCase()
  const meta = getProviderMeta(provider)
  const providerType = trim(payload.provider_type ?? payload.providerType ?? meta?.supportedTypes?.[0] ?? 'chat').toLowerCase()
  const apiKey = trim(payload.api_key ?? payload.apiKey)

  return {
    name: trim(payload.name) || (meta?.label || provider || 'AI Provider'),
    provider,
    providerType,
    accountEmail: trim(payload.account_email ?? payload.accountEmail),
    projectName: trim(payload.project_name ?? payload.projectName),
    apiKey,
    defaultModel: trim(payload.default_model ?? payload.defaultModel ?? meta?.defaultModel ?? ''),
    supportedModels: normalizeTextList(payload.supported_models ?? payload.supportedModels),
    endpointOverride: trim(payload.endpoint_override ?? payload.endpointOverride),
    notes: trim(payload.notes),
    enabled: payload.enabled == null ? true : !!payload.enabled,
    priority: clamp(Number(payload.priority ?? meta?.defaultPriority ?? 50) || (meta?.defaultPriority ?? 50), 1, 999),
    requestsPerMinute: clamp(Number(payload.requests_per_minute ?? payload.requestsPerMinute ?? meta?.safeRequestsPerMinute ?? 10) || (meta?.safeRequestsPerMinute ?? 10), 1, 120),
    maxInputChars: clamp(Number(payload.max_input_chars ?? payload.maxInputChars ?? meta?.safeMaxInputChars ?? 1000) || (meta?.safeMaxInputChars ?? 1000), 200, 4000),
    maxCompletionTokens: clamp(Number(payload.max_completion_tokens ?? payload.maxCompletionTokens ?? meta?.safeMaxCompletionTokens ?? 1200) || (meta?.safeMaxCompletionTokens ?? 1200), 128, 8192),
    timeoutMs: clamp(Number(payload.timeout_ms ?? payload.timeoutMs ?? meta?.safeTimeoutMs ?? 15000) || (meta?.safeTimeoutMs ?? 15000), 3000, 60000),
    cooldownSeconds: clamp(Number(payload.cooldown_seconds ?? payload.cooldownSeconds ?? meta?.safeCooldownSeconds ?? 20) || (meta?.safeCooldownSeconds ?? 20), 5, 300),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function serializeProviderRow(row: any, encryptionKey: string | undefined) {
  const apiKey = await decryptSecret(row?.api_key_encrypted || '', encryptionKey)
  const providerMeta = getProviderMeta(row?.provider)
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    provider_type: row.provider_type,
    account_email: row.account_email || '',
    project_name: row.project_name || '',
    default_model: row.default_model || '',
    supported_models: parseJsonSafe(row.supported_models_json || '[]', []),
    endpoint_override: row.endpoint_override || '',
    notes: row.notes || '',
    enabled: !!row.enabled,
    last_status: row.last_status || 'untested',
    last_error: row.last_error || '',
    last_checked_at: row.last_checked_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
    provider_label: providerMeta?.label || row.provider,
    supported_types: providerMeta?.supportedTypes || [row.provider_type || 'chat'],
    priority: Number(row.priority || providerMeta?.defaultPriority || 50) || 50,
    requests_per_minute: Number(row.requests_per_minute || providerMeta?.safeRequestsPerMinute || 10) || 10,
    max_input_chars: Number(row.max_input_chars || providerMeta?.safeMaxInputChars || 1000) || 1000,
    max_completion_tokens: Number(row.max_completion_tokens || providerMeta?.safeMaxCompletionTokens || 1200) || 1200,
    timeout_ms: Number(row.timeout_ms || providerMeta?.safeTimeoutMs || 15000) || 15000,
    cooldown_seconds: Number(row.cooldown_seconds || providerMeta?.safeCooldownSeconds || 20) || 20,
    key_masked: maskApiKey(apiKey),
    has_key: !!apiKey,
  }
}

function buildProviderHttpError(provider: string, endpoint: string, status: number, json: any, fallbackMessage: string): Error {
  const providerLabel = getProviderMeta(provider)?.label || provider || 'AI provider'
  const upstreamMessage = trim(json?.error?.message || json?.message || '')
  const host = (() => {
    try {
      return new URL(endpoint).host
    } catch (_) {
      return endpoint
    }
  })()
  if (status === 403 && /access denied|network settings/i.test(upstreamMessage)) {
    return new Error(`${providerLabel} blocked this runtime from reaching ${host}. Check firewall, region, or provider network restrictions.`)
  }
  return new Error(upstreamMessage || fallbackMessage || `AI request failed (${status || 'unknown'})`)
}

function buildGoogleMessageContents(messages: Array<{ role?: string; content?: string }> = []) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: trim(message.content) }],
  }))
}

function joinGoogleTextParts(parts: Array<{ text?: string }> = []): string {
  const lines: string[] = []
  for (const part of parts) {
    const text = trim(part?.text)
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

// Ported from backend/src/services/aiGateway.ts's providerCanUseWebResearch.
// Only Groq's "compound" models currently support the built-in
// web_search/visit_website tool loop this gates.
export function providerCanUseWebResearch(providerConfig: any): boolean {
  return trim(providerConfig?.provider).toLowerCase() === 'groq'
    && trim(providerConfig?.default_model).toLowerCase().startsWith('groq/compound')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callChatProvider(providerConfig: any, messages: Array<{ role: string; content: string }>, options: Record<string, unknown>, encryptionKey: string | undefined) {
  const provider = trim(providerConfig?.provider).toLowerCase()
  const meta = getProviderMeta(provider)
  const apiKey = await decryptSecret(providerConfig?.api_key_encrypted || '', encryptionKey)
  if (!apiKey) throw new Error('Provider API key is unavailable')

  const model = trim((options.model as string) || providerConfig?.default_model)
  if (!model) throw new Error('Choose a model before testing or chatting')
  const timeoutMs = clamp(
    Number(options.timeoutMs || providerConfig?.timeout_ms || meta?.safeTimeoutMs || 15000) || (meta?.safeTimeoutMs || 15000),
    3000,
    60000,
  )
  const requestSignal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined

  if (provider === 'groq' || provider === 'mistral' || provider === 'cerebras') {
    const endpoint = assertSafeOutboundUrl(trim(providerConfig?.endpoint_override) || meta?.defaultEndpoint)
    const temperature = typeof options.temperature === 'number' ? options.temperature : 0.45
    const topP = typeof options.topP === 'number'
      ? options.topP
      : (provider === 'mistral' && temperature <= 0 ? 1 : 0.95)
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature,
      top_p: topP,
      stream: false,
    }

    if (provider === 'groq' || provider === 'cerebras') {
      body.max_completion_tokens = clamp(Number(options.maxCompletionTokens || 1800) || 1800, 128, 8192)
    } else {
      body.max_tokens = clamp(Number(options.maxCompletionTokens || 1800) || 1800, 128, 8192)
    }

    if (provider === 'groq' && options.enableWebResearch && model.startsWith('groq/compound')) {
      body.compound_custom = { tools: { enabled_tools: ['web_search', 'visit_website'] } }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: requestSignal,
      body: JSON.stringify(body),
    })
    const json: any = await response.json().catch(() => ({}))
    if (!response.ok) throw buildProviderHttpError(provider, endpoint, response.status, json, `AI request failed (${response.status})`)
    return { text: trim(json?.choices?.[0]?.message?.content || ''), raw: json }
  }

  if (provider === 'google') {
    const base = assertSafeOutboundUrl(trim(providerConfig?.endpoint_override) || meta?.defaultEndpoint)
    const endpoint = `${base}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: requestSignal,
      body: JSON.stringify({
        contents: buildGoogleMessageContents(messages),
        generationConfig: {
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.45,
          topP: typeof options.topP === 'number' ? options.topP : 0.95,
          maxOutputTokens: clamp(Number(options.maxCompletionTokens || 1800) || 1800, 128, 8192),
        },
      }),
    })
    const json: any = await response.json().catch(() => ({}))
    if (!response.ok) throw buildProviderHttpError(provider, endpoint, response.status, json, `Google AI request failed (${response.status})`)
    return { text: trim(joinGoogleTextParts(json?.candidates?.[0]?.content?.parts || [])), raw: json }
  }

  throw new Error('This provider does not support chat completions')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function testProviderConfig(providerConfig: any, encryptionKey: string | undefined) {
  if (trim(providerConfig?.provider_type).toLowerCase() === 'embed') {
    const provider = trim(providerConfig?.provider).toLowerCase()
    const apiKey = await decryptSecret(providerConfig?.api_key_encrypted || '', encryptionKey)
    if (!apiKey) throw new Error('Provider API key is unavailable')
    const model = trim(providerConfig?.default_model)
    if (!model) throw new Error('Choose a model before testing this embedding provider')

    if (provider === 'cohere') {
      const endpoint = assertSafeOutboundUrl(trim(providerConfig?.endpoint_override) || PROVIDER_META.cohere.defaultEndpoint)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout ? AbortSignal.timeout(clamp(Number(providerConfig?.timeout_ms || PROVIDER_META.cohere.safeTimeoutMs || 12000), 3000, 60000)) : undefined,
        body: JSON.stringify({ model, texts: ['health check'], input_type: 'search_document', truncate: 'END' }),
      })
      const json: any = await response.json().catch(() => ({}))
      if (!response.ok) throw buildProviderHttpError(provider, endpoint, response.status, json, `Cohere request failed (${response.status})`)
      return { success: true, message: `Embedding provider responded at ${new Date().toISOString()}` }
    }
    throw new Error('This embedding provider test is not supported yet')
  }

  const result = await callChatProvider(providerConfig, [
    { role: 'user', content: 'Reply with the word OK only.' },
  ], { maxCompletionTokens: 32, temperature: 0 }, encryptionKey)

  return { success: true, message: trim(result.text || 'OK') }
}
