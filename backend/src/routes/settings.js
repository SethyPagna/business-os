'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, broadcast, logOp } = require('../helpers')
const { authToken } = require('../middleware')

const router = express.Router()

// GET /api/settings
router.get('/', authToken, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const obj  = {}
  rows.forEach(r => { obj[r.key] = r.value })
  res.json(obj)
})

// POST /api/settings
router.post('/', authToken, (req, res) => {
  const t0      = Date.now()
  const updates = req.body || {}
  const upsert  = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  )
  db.transaction(() => {
    Object.entries(updates).forEach(([k, v]) => upsert.run(k, String(v)))
  })()
  logOp('settings:set', Date.now() - t0)
  broadcast('settings')
  ok(res, {})
})

module.exports = router
