'use strict'

const express = require('express')
const { db } = require('../database')
const { authToken } = require('../middleware')
const { ok, err, audit } = require('../helpers')
const {
  PROVIDER_META,
  normalizeProviderPayload,
  serializeProviderRow,
  encryptSecret,
  testProviderConfig,
  parseJsonSafe,
} = require('../services/aiGateway')

const router = express.Router()

function getActor(req) {
  return {
    userId: Number(req.body?.userId || req.query?.userId || 0) || null,
    userName: String(req.body?.userName || req.query?.userName || '').trim() || null,
  }
}

function listProviders() {
  const rows = db.prepare(`
    SELECT *
    FROM ai_provider_configs
    ORDER BY enabled DESC, priority ASC, updated_at DESC, id DESC
  `).all()
  return rows.map(serializeProviderRow)
}

function getProviderRow(id) {
  return db.prepare('SELECT * FROM ai_provider_configs WHERE id = ?').get(Number(id))
}

router.get('/providers', authToken, (_req, res) => {
  ok(res, {
    items: listProviders(),
    providerMeta: PROVIDER_META,
  })
})

router.post('/providers', authToken, async (req, res) => {
  try {
    const actor = getActor(req)
    const payload = normalizeProviderPayload(req.body || {})
    if (!payload.provider || !PROVIDER_META[payload.provider]) {
      return err(res, 'Choose a supported AI provider')
    }
    if (!payload.apiKey) return err(res, 'API key is required')

    const info = db.prepare(`
      INSERT INTO ai_provider_configs (
        name, provider, provider_type, account_email, project_name,
        api_key_encrypted, default_model, supported_models_json,
        endpoint_override, notes, enabled, priority, requests_per_minute,
        max_input_chars, max_completion_tokens, timeout_ms, cooldown_seconds,
        created_by_id, created_by_name,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      payload.name,
      payload.provider,
      payload.providerType,
      payload.accountEmail || null,
      payload.projectName || null,
      encryptSecret(payload.apiKey),
      payload.defaultModel || null,
      JSON.stringify(payload.supportedModels || []),
      payload.endpointOverride || null,
      payload.notes || null,
      payload.enabled ? 1 : 0,
      payload.priority,
      payload.requestsPerMinute,
      payload.maxInputChars,
      payload.maxCompletionTokens,
      payload.timeoutMs,
      payload.cooldownSeconds,
      actor.userId,
      actor.userName,
      new Date().toISOString(),
      new Date().toISOString(),
    )

    const created = getProviderRow(info.lastInsertRowid)
    audit(actor.userId, actor.userName, 'create', 'ai_provider_config', created.id, {
      provider: created.provider,
      name: created.name,
      provider_type: created.provider_type,
    })
    ok(res, { item: serializeProviderRow(created) })
  } catch (error) {
    err(res, error?.message || 'Failed to save AI provider')
  }
})

router.put('/providers/:id', authToken, async (req, res) => {
  try {
    const actor = getActor(req)
    const existing = getProviderRow(req.params.id)
    if (!existing) return err(res, 'AI provider not found', 404)

    const payload = normalizeProviderPayload(req.body || {})
    const apiKeyEncrypted = payload.apiKey ? encryptSecret(payload.apiKey) : existing.api_key_encrypted
    db.prepare(`
      UPDATE ai_provider_configs
      SET name = ?,
          provider = ?,
          provider_type = ?,
          account_email = ?,
          project_name = ?,
          api_key_encrypted = ?,
          default_model = ?,
          supported_models_json = ?,
          endpoint_override = ?,
          notes = ?,
          enabled = ?,
          priority = ?,
          requests_per_minute = ?,
          max_input_chars = ?,
          max_completion_tokens = ?,
          timeout_ms = ?,
          cooldown_seconds = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      payload.name || existing.name,
      payload.provider || existing.provider,
      payload.providerType || existing.provider_type,
      payload.accountEmail || null,
      payload.projectName || null,
      apiKeyEncrypted,
      payload.defaultModel || null,
      JSON.stringify(payload.supportedModels || []),
      payload.endpointOverride || null,
      payload.notes || null,
      payload.enabled ? 1 : 0,
      payload.priority,
      payload.requestsPerMinute,
      payload.maxInputChars,
      payload.maxCompletionTokens,
      payload.timeoutMs,
      payload.cooldownSeconds,
      new Date().toISOString(),
      existing.id,
    )

    const updated = getProviderRow(existing.id)
    audit(actor.userId, actor.userName, 'update', 'ai_provider_config', updated.id, {
      provider: updated.provider,
      name: updated.name,
      provider_type: updated.provider_type,
      api_key_updated: !!payload.apiKey,
    })
    ok(res, { item: serializeProviderRow(updated) })
  } catch (error) {
    err(res, error?.message || 'Failed to update AI provider')
  }
})

router.post('/providers/:id/test', authToken, async (req, res) => {
  try {
    const actor = getActor(req)
    const row = getProviderRow(req.params.id)
    if (!row) return err(res, 'AI provider not found', 404)

    const result = await testProviderConfig(row)
    db.prepare(`
      UPDATE ai_provider_configs
      SET last_status = ?, last_error = ?, last_checked_at = ?, updated_at = ?
      WHERE id = ?
    `).run('ok', '', new Date().toISOString(), new Date().toISOString(), row.id)

    audit(actor.userId, actor.userName, 'test', 'ai_provider_config', row.id, {
      provider: row.provider,
      name: row.name,
      status: 'ok',
    })
    ok(res, {
      success: true,
      message: result.message || 'Provider test passed',
      item: serializeProviderRow(getProviderRow(row.id)),
    })
  } catch (error) {
    const row = getProviderRow(req.params.id)
    if (row) {
      db.prepare(`
        UPDATE ai_provider_configs
        SET last_status = ?, last_error = ?, last_checked_at = ?, updated_at = ?
        WHERE id = ?
      `).run('error', String(error?.message || 'Provider test failed'), new Date().toISOString(), new Date().toISOString(), row.id)
    }
    err(res, error?.message || 'Provider test failed')
  }
})

router.delete('/providers/:id', authToken, (req, res) => {
  try {
    const actor = getActor(req)
    const row = getProviderRow(req.params.id)
    if (!row) return err(res, 'AI provider not found', 404)

    db.prepare('DELETE FROM ai_provider_configs WHERE id = ?').run(row.id)
    audit(actor.userId, actor.userName, 'delete', 'ai_provider_config', row.id, {
      provider: row.provider,
      name: row.name,
      provider_type: row.provider_type,
    })
    ok(res, { success: true })
  } catch (error) {
    err(res, error?.message || 'Failed to delete AI provider')
  }
})

router.get('/responses', authToken, (req, res) => {
  const limit = Math.min(200, Math.max(20, Number(req.query?.limit || 80) || 80))
  const rows = db.prepare(`
    SELECT *
    FROM ai_response_logs
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(limit)

  ok(res, {
    items: rows.map((row) => ({
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
    })),
  })
})

module.exports = router
