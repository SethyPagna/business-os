'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')

const router = express.Router()
const DEFAULT_CATEGORY_COLOR = '#6366f1'

function normalizeLookup(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeColor(value) {
  const raw = String(value || '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : DEFAULT_CATEGORY_COLOR
}

router.get('/', authToken, requirePermission('products'), (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all())
})

router.post('/', authToken, requirePermission('products'), (req, res) => {
  const { name, color } = req.body || {}
  const actor = getAuditActor(req)
  const trimmedName = String(name || '').trim().replace(/\s+/g, ' ')
  if (!trimmedName) return err(res, 'Name required')
  try {
    const duplicate = db.prepare(`
      SELECT id
      FROM categories
      WHERE lower(trim(name)) = lower(trim(?))
      LIMIT 1
    `).get(trimmedName)
    if (duplicate) return err(res, 'Category already exists')
    const now = new Date().toISOString()
    const r = db.prepare('INSERT INTO categories (name, color, updated_at) VALUES (?, ?, ?)')
      .run(trimmedName, normalizeColor(color), now)
    audit(actor.userId, actor.userName, 'create', 'category', r.lastInsertRowid, { name: trimmedName })
    broadcast('categories')
    ok(res, db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid))
  } catch (e) {
    err(res, e.message.includes('UNIQUE') ? 'Category already exists' : e.message)
  }
})

router.put('/:id', authToken, requirePermission('products'), (req, res) => {
  const { name, color } = req.body || {}
  const actor = getAuditActor(req)
  const trimmedName = String(name || '').trim().replace(/\s+/g, ' ')
  const normalizedName = normalizeLookup(trimmedName)
  if (!trimmedName) return err(res, 'Name required')
  try {
    const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Category not found', 404)
    assertUpdatedAtMatch('category', current, getExpectedUpdatedAt(req.body || {}))

    const duplicate = db.prepare(`
      SELECT *
      FROM categories
      WHERE id != ?
        AND lower(trim(name)) = lower(trim(?))
      LIMIT 1
    `).get(req.params.id, trimmedName)

    const now = new Date().toISOString()
    const normalizedCurrent = normalizeLookup(current.name)
    const nextColor = normalizeColor(color)
    let responseRow = null
    let mergedIntoId = null

    db.transaction(() => {
      if (duplicate) {
        db.prepare(`
          UPDATE categories
          SET name = ?, color = ?, updated_at = ?
          WHERE id = ?
        `).run(trimmedName, nextColor, now, duplicate.id)
        db.prepare(`
          UPDATE products
          SET category = ?, updated_at = ?
          WHERE lower(trim(category)) IN (?, ?)
        `).run(trimmedName, now, normalizedCurrent, normalizedName)
        db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id)
        responseRow = db.prepare('SELECT * FROM categories WHERE id = ?').get(duplicate.id)
        mergedIntoId = duplicate.id
      } else {
        db.prepare(`
          UPDATE categories
          SET name = ?, color = ?, updated_at = ?
          WHERE id = ?
        `).run(trimmedName, nextColor, now, req.params.id)
        db.prepare(`
          UPDATE products
          SET category = ?, updated_at = ?
          WHERE lower(trim(category)) = ?
        `).run(trimmedName, now, normalizedCurrent)
        responseRow = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id)
      }
    })()

    audit(actor.userId, actor.userName, duplicate ? 'merge' : 'update', 'category', mergedIntoId || req.params.id, {
      name: trimmedName,
      merged_from_id: duplicate ? Number(req.params.id) : null,
    })
    broadcast('categories')
    broadcast('products')
    ok(res, {
      ...responseRow,
      merged: !!duplicate,
      merged_from_id: duplicate ? Number(req.params.id) : null,
    })
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
