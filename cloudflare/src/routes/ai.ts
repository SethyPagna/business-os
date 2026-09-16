// Ported from backend/src/routes/ai.ts. This route did not exist anywhere
// in the Worker before -- Hono has no matching handler for /ai/*, so every
// request 404s with Hono's default response. That's the exact bug reported:
// "api/ai/providers?...userName=Admin" failing with a plain 404 (not the
// masked-500 pattern that action-history had -- there was just nothing here
// to even throw).
import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse } from '../lib/conflictControl'
import {
  PROVIDER_META,
  normalizeProviderPayload,
  serializeProviderRow,
  testProviderConfig,
  parseJsonSafe,
} from '../lib/aiGateway'
import { encryptSecret } from '../lib/secretCrypto'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)
// AI provider configs hold encrypted third-party API keys -- gate every
// route here behind the `settings` permission, matching legacy's
// `requirePermission('settings')`. A permission system now exists in this
// Worker (lib/permissions.ts, used by system.ts/compat.ts/users.ts/
// lookups.ts) so the earlier "no permission helpers exist yet" rationale
// for skipping this no longer applies -- was a real gap, any logged-in
// user (e.g. a cashier account) could view, create, edit, delete, or test
// AI provider credentials.
app.use('*', async (c, next) => {
  const user = c.get('user')
  if (!hasPermission(user, 'settings')) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return next()
})

function actorFrom(user: SessionUser) {
  return { userId: user?.id ?? null, userName: actorSnapshot(user) || '' }
}

async function getProviderRow(env: Env, id: string | number): Promise<any> {
  return getDb(env).prepare('SELECT * FROM ai_provider_configs WHERE id = @id').get({ id: Number(id) })
}

app.get('/providers', async (c) => {
  const rows = await getDb(c.env).prepare(`
    SELECT * FROM ai_provider_configs
    ORDER BY enabled DESC, priority ASC, updated_at DESC, id DESC
  `).all()
  const items = []
  for (const row of rows || []) {
    items.push(await serializeProviderRow(row, c.env.APP_ENCRYPTION_KEY))
  }
  return c.json({ items, providerMeta: PROVIDER_META })
})

app.post('/providers', async (c) => {
  try {
    const actor = actorFrom(c.get('user'))
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    const payload = normalizeProviderPayload(body)
    if (!payload.provider || !PROVIDER_META[payload.provider]) {
      return c.json({ success: false, error: 'Choose a supported AI provider' }, 400)
    }
    if (!payload.apiKey) return c.json({ success: false, error: 'API key is required' }, 400)

    const nowIso = new Date().toISOString()
    const encryptedKey = await encryptSecret(payload.apiKey, c.env.APP_ENCRYPTION_KEY)
    const result = await getDb(c.env).prepare(`
      INSERT INTO ai_provider_configs (
        name, provider, provider_type, account_email, project_name,
        api_key_encrypted, default_model, supported_models_json,
        endpoint_override, notes, enabled, priority, requests_per_minute,
        max_input_chars, max_completion_tokens, timeout_ms, cooldown_seconds,
        created_by_id, created_by_name, created_at, updated_at
      ) VALUES (@name, @provider, @provider_type, @account_email, @project_name,
        @api_key_encrypted, @default_model, @supported_models_json,
        @endpoint_override, @notes, @enabled, @priority, @requests_per_minute,
        @max_input_chars, @max_completion_tokens, @timeout_ms, @cooldown_seconds,
        @created_by_id, @created_by_name, @created_at, @updated_at)
    `).run({
      name: payload.name,
      provider: payload.provider,
      provider_type: payload.providerType,
      account_email: payload.accountEmail || null,
      project_name: payload.projectName || null,
      api_key_encrypted: encryptedKey,
      default_model: payload.defaultModel || null,
      supported_models_json: JSON.stringify(payload.supportedModels || []),
      endpoint_override: payload.endpointOverride || null,
      notes: payload.notes || null,
      enabled: payload.enabled ? 1 : 0,
      priority: payload.priority,
      requests_per_minute: payload.requestsPerMinute,
      max_input_chars: payload.maxInputChars,
      max_completion_tokens: payload.maxCompletionTokens,
      timeout_ms: payload.timeoutMs,
      cooldown_seconds: payload.cooldownSeconds,
      created_by_id: actor.userId,
      created_by_name: actor.userName,
      created_at: nowIso,
      updated_at: nowIso,
    })

    const created = await getProviderRow(c.env, result.lastInsertRowid)
    await audit(c.env, actor.userId, actor.userName, 'create', 'ai_provider_config', created.id, {
      provider: created.provider,
      name: created.name,
      provider_type: created.provider_type,
    })
    return c.json({ success: true, item: await serializeProviderRow(created, c.env.APP_ENCRYPTION_KEY) })
  } catch (error: any) {
    return c.json({ success: false, error: error?.message || 'Failed to save AI provider' }, 500)
  }
})

app.put('/providers/:id', async (c) => {
  try {
    const actor = actorFrom(c.get('user'))
    const existing = await getProviderRow(c.env, c.req.param('id'))
    if (!existing) return c.json({ success: false, error: 'AI provider not found' }, 404)
    const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
    assertUpdatedAtMatch('ai_provider_config', existing, getExpectedUpdatedAt(body))

    const payload = normalizeProviderPayload(body)
    const apiKeyEncrypted = payload.apiKey ? await encryptSecret(payload.apiKey, c.env.APP_ENCRYPTION_KEY) : existing.api_key_encrypted
    const nowIso = new Date().toISOString()
    await getDb(c.env).prepare(`
      UPDATE ai_provider_configs
      SET name = @name, provider = @provider, provider_type = @provider_type,
          account_email = @account_email, project_name = @project_name,
          api_key_encrypted = @api_key_encrypted, default_model = @default_model,
          supported_models_json = @supported_models_json, endpoint_override = @endpoint_override,
          notes = @notes, enabled = @enabled, priority = @priority,
          requests_per_minute = @requests_per_minute, max_input_chars = @max_input_chars,
          max_completion_tokens = @max_completion_tokens, timeout_ms = @timeout_ms,
          cooldown_seconds = @cooldown_seconds, updated_at = @updated_at
      WHERE id = @id
    `).run({
      name: payload.name || existing.name,
      provider: payload.provider || existing.provider,
      provider_type: payload.providerType || existing.provider_type,
      account_email: payload.accountEmail || null,
      project_name: payload.projectName || null,
      api_key_encrypted: apiKeyEncrypted,
      default_model: payload.defaultModel || null,
      supported_models_json: JSON.stringify(payload.supportedModels || []),
      endpoint_override: payload.endpointOverride || null,
      notes: payload.notes || null,
      enabled: payload.enabled ? 1 : 0,
      priority: payload.priority,
      requests_per_minute: payload.requestsPerMinute,
      max_input_chars: payload.maxInputChars,
      max_completion_tokens: payload.maxCompletionTokens,
      timeout_ms: payload.timeoutMs,
      cooldown_seconds: payload.cooldownSeconds,
      updated_at: nowIso,
      id: existing.id,
    })

    const updated = await getProviderRow(c.env, existing.id)
    await audit(c.env, actor.userId, actor.userName, 'update', 'ai_provider_config', updated.id, {
      provider: updated.provider,
      name: updated.name,
      provider_type: updated.provider_type,
      api_key_updated: !!payload.apiKey,
    })
    return c.json({ success: true, item: await serializeProviderRow(updated, c.env.APP_ENCRYPTION_KEY) })
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body, status } = writeConflictResponse(error)
      return c.json(body, status)
    }
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to update AI provider' }, 500)
  }
})

app.post('/providers/:id/test', async (c) => {
  const actor = actorFrom(c.get('user'))
  const rlKey = actor.userId ? `user:${actor.userId}` : getClientIp(c.req.raw)
  const rl = await checkRateLimit(c.env, 'ai:provider_test', rlKey, 20, 10 * 60 * 1000)
  if (!rl.allowed) return c.json({ success: false, error: 'Too many AI provider tests. Try again shortly.' }, 429)
  const row = await getProviderRow(c.env, c.req.param('id'))
  if (!row) return c.json({ success: false, error: 'AI provider not found' }, 404)

  try {
    const result = await testProviderConfig(row, c.env.APP_ENCRYPTION_KEY)
    const nowIso = new Date().toISOString()
    await getDb(c.env).prepare(`
      UPDATE ai_provider_configs SET last_status = @status, last_error = @last_error, last_checked_at = @checked_at, updated_at = @updated_at WHERE id = @id
    `).run({ status: 'ok', last_error: '', checked_at: nowIso, updated_at: nowIso, id: row.id })

    await audit(c.env, actor.userId, actor.userName, 'test', 'ai_provider_config', row.id, {
      provider: row.provider,
      name: row.name,
      status: 'ok',
    })
    return c.json({
      success: true,
      message: result.message || 'Provider test passed',
      passed: true,
      item: await serializeProviderRow(await getProviderRow(c.env, row.id), c.env.APP_ENCRYPTION_KEY),
    })
  } catch (error: any) {
    const nowIso = new Date().toISOString()
    await getDb(c.env).prepare(`
      UPDATE ai_provider_configs SET last_status = @status, last_error = @last_error, last_checked_at = @checked_at, updated_at = @updated_at WHERE id = @id
    `).run({ status: 'error', last_error: String(error?.message || 'Provider test failed'), checked_at: nowIso, updated_at: nowIso, id: row.id })

    return c.json({
      success: true,
      passed: false,
      message: error?.message || 'Provider test failed',
      item: await serializeProviderRow(await getProviderRow(c.env, row.id), c.env.APP_ENCRYPTION_KEY),
    })
  }
})

app.delete('/providers/:id', async (c) => {
  try {
    const actor = actorFrom(c.get('user'))
    const row = await getProviderRow(c.env, c.req.param('id'))
    if (!row) return c.json({ success: false, error: 'AI provider not found' }, 404)
    const query = Object.fromEntries(new URL(c.req.url).searchParams)
    assertUpdatedAtMatch('ai_provider_config', row, getExpectedUpdatedAt(query))

    await getDb(c.env).prepare('DELETE FROM ai_provider_configs WHERE id = @id').run({ id: row.id })
    await audit(c.env, actor.userId, actor.userName, 'delete', 'ai_provider_config', row.id, {
      provider: row.provider,
      name: row.name,
      provider_type: row.provider_type,
    })
    return c.json({ success: true })
  } catch (error) {
    if (error instanceof WriteConflictError) {
      const { body, status } = writeConflictResponse(error)
      return c.json(body, status)
    }
    return c.json({ success: false, error: (error as Error)?.message || 'Failed to delete AI provider' }, 500)
  }
})

app.get('/responses', async (c) => {
  const limit = Math.min(200, Math.max(20, Number(c.req.query('limit') || 80) || 80))
  const rows = await getDb(c.env).prepare(`
    SELECT * FROM ai_response_logs ORDER BY created_at DESC, id DESC LIMIT @limit
  `).all({ limit })

  const items = (rows || []).map((row: any) => ({
    id: row.id,
    surface: row.surface,
    provider_config_id: row.provider_config_id,
    provider_name: row.provider_name || '',
    provider: row.provider || '',
    model: row.model || '',
    actor_user_id: row.actor_user_id,
    actor_user_name: row.actor_user_name || '',
    actor_label: row.actor_label || '',
    question_text: row.question_text || '',
    answer_text: row.answer_text || '',
    profile: parseJsonSafe(row.profile_json || '{}', {}),
    candidate_products: parseJsonSafe(row.candidate_products_json || '[]', []),
    recommendations: parseJsonSafe(row.recommendations_json || '[]', []),
    citations: parseJsonSafe(row.citations_json || '[]', []),
    created_at: row.created_at || '',
  }))
  return c.json({ items })
})

export default app
