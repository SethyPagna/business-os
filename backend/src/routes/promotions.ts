'use strict'
const express = require('express')
const { db } = require('../database.ts')
const { ok, err, audit, broadcast } = require('../helpers.ts')
const { authToken, requirePermission, getAuditActor } = require('../middleware.ts')

const router = express.Router()

const LINK_TYPES = new Set(['none', 'product', 'url'])

function normalizeText(value, maxLen = 500) {
  return String(value || '').trim().slice(0, maxLen)
}

function normalizeColor(value) {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : null
}

function normalizePromotionInput(body = {}) {
  const linkType = LINK_TYPES.has(body.link_type) ? body.link_type : 'none'
  return {
    title: normalizeText(body.title, 120),
    subtitle: normalizeText(body.subtitle, 240) || null,
    image_path: normalizeText(body.image_path, 500) || null,
    link_type: linkType,
    link_product_id: linkType === 'product' ? (Number(body.link_product_id) || null) : null,
    link_url: linkType === 'url' ? (normalizeText(body.link_url, 500) || null) : null,
    badge_text: normalizeText(body.badge_text, 40) || null,
    badge_color: normalizeColor(body.badge_color),
    is_active: body.is_active === false || body.is_active === 0 ? 0 : 1,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    starts_at: body.starts_at ? String(body.starts_at) : null,
    ends_at: body.ends_at ? String(body.ends_at) : null,
  }
}

// Admin: list every promotion (active or not), for the editor.
router.get('/', authToken, requirePermission('products'), (req, res) => {
  ok(res, db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all())
})

router.post('/', authToken, requirePermission('products'), (req, res) => {
  const actor = getAuditActor(req)
  const input = normalizePromotionInput(req.body)
  if (!input.title) return err(res, 'Title required')
  if (input.link_type === 'product' && !input.link_product_id) return err(res, 'Choose a product to link to')
  if (input.link_type === 'url' && !input.link_url) return err(res, 'Enter a link URL')
  if (input.link_type === 'product') {
    const productExists = db.prepare('SELECT id FROM products WHERE id = ?').get(input.link_product_id)
    if (!productExists) return err(res, 'Linked product not found')
  }

  const now = new Date().toISOString()
  const r = db.prepare(`
    INSERT INTO promotions (
      title, subtitle, image_path, link_type, link_product_id, link_url,
      badge_text, badge_color, is_active, sort_order, starts_at, ends_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.title, input.subtitle, input.image_path, input.link_type, input.link_product_id, input.link_url,
    input.badge_text, input.badge_color, input.is_active, input.sort_order, input.starts_at, input.ends_at, now,
  )
  audit(actor.userId, actor.userName, 'create', 'promotion', r.lastInsertRowid, { title: input.title })
  broadcast('promotions')
  ok(res, db.prepare('SELECT * FROM promotions WHERE id = ?').get(r.lastInsertRowid))
})

router.put('/:id', authToken, requirePermission('products'), (req, res) => {
  const actor = getAuditActor(req)
  const current = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id)
  if (!current) return err(res, 'Promotion not found', 404)
  const input = normalizePromotionInput(req.body)
  if (!input.title) return err(res, 'Title required')
  if (input.link_type === 'product' && !input.link_product_id) return err(res, 'Choose a product to link to')
  if (input.link_type === 'url' && !input.link_url) return err(res, 'Enter a link URL')
  if (input.link_type === 'product') {
    const productExists = db.prepare('SELECT id FROM products WHERE id = ?').get(input.link_product_id)
    if (!productExists) return err(res, 'Linked product not found')
  }

  db.prepare(`
    UPDATE promotions SET
      title = ?, subtitle = ?, image_path = ?, link_type = ?, link_product_id = ?, link_url = ?,
      badge_text = ?, badge_color = ?, is_active = ?, sort_order = ?, starts_at = ?, ends_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.title, input.subtitle, input.image_path, input.link_type, input.link_product_id, input.link_url,
    input.badge_text, input.badge_color, input.is_active, input.sort_order, input.starts_at, input.ends_at,
    new Date().toISOString(), req.params.id,
  )
  audit(actor.userId, actor.userName, 'update', 'promotion', req.params.id, { title: input.title })
  broadcast('promotions')
  ok(res, db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id))
})

// Bulk reorder, for a drag-and-drop editor: body = { order: [id, id, id, ...] }
router.put('/reorder/all', authToken, requirePermission('products'), (req, res) => {
  const order = Array.isArray(req.body?.order) ? req.body.order : []
  if (!order.length) return err(res, 'order array required')
  const actor = getAuditActor(req)
  const update = db.prepare('UPDATE promotions SET sort_order = ?, updated_at = ? WHERE id = ?')
  const now = new Date().toISOString()
  order.forEach((id, index) => update.run(index, now, Number(id)))
  audit(actor.userId, actor.userName, 'reorder', 'promotion', null, { order })
  broadcast('promotions')
  ok(res, db.prepare('SELECT * FROM promotions ORDER BY sort_order ASC, id ASC').all())
})

router.delete('/:id', authToken, requirePermission('products'), (req, res) => {
  const actor = getAuditActor(req)
  const current = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id)
  if (!current) return err(res, 'Promotion not found', 404)
  db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id)
  audit(actor.userId, actor.userName, 'delete', 'promotion', req.params.id, { title: current.title })
  broadcast('promotions')
  ok(res, { deleted: true })
})

module.exports = router
