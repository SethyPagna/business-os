'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken } = require('../middleware')

const router = express.Router()

router.get('/', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all())
})

router.post('/', authToken, (req, res) => {
  const { name, color, userId, userName } = req.body || {}
  if (!name?.trim()) return err(res, 'Name required')
  try {
    const r = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)')
      .run(name.trim(), color || '#6366f1')
    audit(userId, userName, 'create', 'category', r.lastInsertRowid, { name })
    broadcast('categories')
    ok(res, { id: r.lastInsertRowid })
  } catch (e) {
    err(res, e.message.includes('UNIQUE') ? 'Category already exists' : e.message)
  }
})

router.put('/:id', authToken, (req, res) => {
  const { name, color, userId, userName } = req.body || {}
  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?')
    .run(name, color || '#6366f1', req.params.id)
  audit(userId, userName, 'update', 'category', req.params.id, { name })
  broadcast('categories')
  ok(res, {})
})

router.delete('/:id', authToken, (req, res) => {
  const { userId, userName } = req.query
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id)
  audit(userId, userName, 'delete', 'category', req.params.id)
  broadcast('categories')
  ok(res, {})
})

module.exports = router
