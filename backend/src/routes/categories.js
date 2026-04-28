'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')

const router = express.Router()

router.get('/', authToken, requirePermission('products'), (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all())
})

router.post('/', authToken, requirePermission('products'), (req, res) => {
  const { name, color } = req.body || {}
  const actor = getAuditActor(req)
  if (!name?.trim()) return err(res, 'Name required')
  try {
    const now = new Date().toISOString()
    const r = db.prepare('INSERT INTO categories (name, color, updated_at) VALUES (?, ?, ?)')
      .run(name.trim(), color || '#6366f1', now)
    audit(actor.userId, actor.userName, 'create', 'category', r.lastInsertRowid, { name })
    broadcast('categories')
    ok(res, db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid))
  } catch (e) {
    err(res, e.message.includes('UNIQUE') ? 'Category already exists' : e.message)
  }
})

router.put('/:id', authToken, requirePermission('products'), (req, res) => {
  const { name, color } = req.body || {}
  const actor = getAuditActor(req)
  if (!String(name || '').trim()) return err(res, 'Name required')
  try {
    const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Category not found', 404)
    assertUpdatedAtMatch('category', current, getExpectedUpdatedAt(req.body || {}))
    db.prepare('UPDATE categories SET name = ?, color = ?, updated_at = ? WHERE id = ?')
      .run(String(name).trim(), color || '#6366f1', new Date().toISOString(), req.params.id)
    audit(actor.userId, actor.userName, 'update', 'category', req.params.id, { name })
    broadcast('categories')
    ok(res, db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id))
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message.includes('UNIQUE') ? 'Category already exists' : e.message)
  }
})

router.delete('/:id', authToken, requirePermission('products'), (req, res) => {
  const actor = getAuditActor(req)
  try {
    const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Category not found', 404)
    assertUpdatedAtMatch('category', current, getExpectedUpdatedAt(req.body || req.query || {}))
    db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'category', req.params.id)
    broadcast('categories')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message || 'Failed to delete category')
  }
})

module.exports = router
