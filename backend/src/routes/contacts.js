'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, bulkImportCSV } = require('../helpers')
const { authToken } = require('../middleware')

const router = express.Router()

function cleanMembershipNumber(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function assertUniqueMembershipNumber(membershipNumber, excludeId = null) {
  const normalized = cleanMembershipNumber(membershipNumber)
  if (!normalized) return null
  const existing = db.prepare(`
    SELECT id
    FROM customers
    WHERE lower(trim(membership_number)) = lower(trim(?))
      AND (? IS NULL OR id != ?)
    LIMIT 1
  `).get(normalized, excludeId, excludeId)
  if (existing) throw new Error(`Membership number "${normalized}" is already in use`)
  return normalized
}

function normalizeConflictMode(value) {
  const mode = String(value || 'skip').trim().toLowerCase()
  return ['skip', 'merge', 'overwrite'].includes(mode) ? mode : 'skip'
}

function toNumber(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function loadPointPolicy() {
  const rows = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN (
      'customer_portal_points_basis',
      'customer_portal_points_per_usd',
      'customer_portal_points_per_khr',
      'exchange_rate'
    )
  `).all()

  const map = {}
  rows.forEach((row) => { map[row.key] = row.value })

  const basis = String(map.customer_portal_points_basis || 'usd').trim().toLowerCase() === 'khr'
    ? 'khr'
    : 'usd'
  const exchangeRate = toNumber(map.exchange_rate, 4100)
  const pointsPerUsd = Math.max(0, toNumber(map.customer_portal_points_per_usd, 1))
  const derivedPointsPerKhr = pointsPerUsd > 0 && exchangeRate > 0 ? (pointsPerUsd / exchangeRate) : 0
  const pointsPerKhr = Math.max(0, toNumber(map.customer_portal_points_per_khr, derivedPointsPerKhr))

  return { basis, pointsPerUsd, pointsPerKhr }
}

function calculatePolicyPoints(amountUsd, amountKhr, policy) {
  if (policy.basis === 'khr') return toNumber(amountKhr, 0) * Math.max(0, policy.pointsPerKhr)
  return toNumber(amountUsd, 0) * Math.max(0, policy.pointsPerUsd)
}

// ── Customers ─────────────────────────────────────────────────────────────────
router.get('/customers', authToken, (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY name').all()
  if (!customers.length) return res.json([])

  const pointsPolicy = loadPointPolicy()
  const salesRows = db.prepare(`
    SELECT
      customer_id,
      COALESCE(SUM(COALESCE(total_usd, 0)), 0) AS sales_usd,
      COALESCE(SUM(COALESCE(total_khr, 0)), 0) AS sales_khr,
      COALESCE(SUM(COALESCE(membership_points_redeemed, 0)), 0) AS redeemed
    FROM sales
    WHERE customer_id IS NOT NULL
      AND COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment')
    GROUP BY customer_id
  `).all()

  const returnRows = db.prepare(`
    SELECT
      customer_id,
      COALESCE(SUM(COALESCE(total_refund_usd, 0)), 0) AS refunds_usd,
      COALESCE(SUM(COALESCE(total_refund_khr, 0)), 0) AS refunds_khr
    FROM returns
    WHERE customer_id IS NOT NULL
      AND COALESCE(status, 'completed') != 'cancelled'
      AND COALESCE(return_scope, 'customer') != 'supplier'
    GROUP BY customer_id
  `).all()

  const rewardRows = db.prepare(`
    SELECT
      customer_id,
      COALESCE(SUM(COALESCE(reward_points, 0)), 0) AS rewarded
    FROM customer_share_submissions
    WHERE customer_id IS NOT NULL
      AND status = 'approved'
    GROUP BY customer_id
  `).all()

  const salesMap = new Map(salesRows.map((row) => [Number(row.customer_id), row]))
  const returnsMap = new Map(returnRows.map((row) => [Number(row.customer_id), row]))
  const rewardsMap = new Map(rewardRows.map((row) => [Number(row.customer_id), row]))

  const enriched = customers.map((customer) => {
    const customerId = Number(customer.id)
    const sales = salesMap.get(customerId) || {}
    const refunds = returnsMap.get(customerId) || {}
    const rewards = rewardsMap.get(customerId) || {}

    const earned = calculatePolicyPoints(sales.sales_usd, sales.sales_khr, pointsPolicy)
    const deducted = calculatePolicyPoints(refunds.refunds_usd, refunds.refunds_khr, pointsPolicy)
    const redeemed = toNumber(sales.redeemed, 0)
    const rewarded = toNumber(rewards.rewarded, 0)
    const balance = Math.max(0, earned - deducted - redeemed + rewarded)

    return {
      ...customer,
      points_earned: Number(earned.toFixed(2)),
      points_deducted: Number(deducted.toFixed(2)),
      points_redeemed: Number(redeemed.toFixed(2)),
      points_rewarded: Number(rewarded.toFixed(2)),
      points_balance: Number(balance.toFixed(2)),
    }
  })

  res.json(enriched)
})

router.post('/customers', authToken, (req, res) => {
  const d = req.body || {}
  if (!d.name?.trim()) return err(res, 'Name required')
  try {
    const membershipNumber = assertUniqueMembershipNumber(d.membership_number)
    const r = db.prepare('INSERT INTO customers (name, membership_number, phone, email, address, company, notes) VALUES (?,?,?,?,?,?,?)')
      .run(d.name.trim(), membershipNumber, d.phone || null, d.email || null, d.address || null, d.company || null, d.notes || null)
    audit(d.userId, d.userName, 'create', 'customer', r.lastInsertRowid, { name: d.name })
    broadcast('customers')
    ok(res, { id: r.lastInsertRowid })
  } catch (e) { err(res, e.message) }
})

router.put('/customers/:id', authToken, (req, res) => {
  const d = req.body || {}
  try {
    const membershipNumber = assertUniqueMembershipNumber(d.membership_number, parseInt(req.params.id, 10))
    db.prepare('UPDATE customers SET name=?, membership_number=?, phone=?, email=?, address=?, company=?, notes=? WHERE id=?')
      .run(d.name, membershipNumber, d.phone || null, d.email || null, d.address || null, d.company || null, d.notes || null, req.params.id)
    audit(d.userId, d.userName, 'update', 'customer', req.params.id)
    broadcast('customers')
    ok(res, {})
  } catch (e) { err(res, e.message) }
})

router.delete('/customers/:id', authToken, (req, res) => {
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id)
  broadcast('customers')
  ok(res, {})
})

router.post('/customers/bulk-import', authToken, (req, res) => {
  const { csvText, userId, userName } = req.body || {}
  const conflictMode = normalizeConflictMode(req.body?.conflictMode)
  const findByMembership = db.prepare(`
    SELECT *
    FROM customers
    WHERE lower(trim(membership_number)) = lower(trim(?))
    LIMIT 1
  `)
  const findByPhone = db.prepare(`
    SELECT *
    FROM customers
    WHERE trim(coalesce(phone, '')) != ''
      AND trim(phone) = trim(?)
    LIMIT 1
  `)
  const findByName = db.prepare(`
    SELECT *
    FROM customers
    WHERE lower(trim(name)) = lower(trim(?))
    LIMIT 1
  `)
  const insertCustomer = db.prepare(`
    INSERT INTO customers (name, membership_number, phone, email, address, company, notes)
    VALUES (?,?,?,?,?,?,?)
  `)
  const updateCustomer = db.prepare(`
    UPDATE customers
    SET name = ?, membership_number = ?, phone = ?, email = ?, address = ?, company = ?, notes = ?
    WHERE id = ?
  `)

  const findExisting = (row) => {
    const membershipNumber = cleanMembershipNumber(row.membership_number)
    if (membershipNumber) {
      const existingMembership = findByMembership.get(membershipNumber)
      if (existingMembership) return existingMembership
    }
    if (row.phone?.trim()) {
      const existingPhone = findByPhone.get(row.phone)
      if (existingPhone) return existingPhone
    }
    if (row.name?.trim()) {
      return findByName.get(row.name) || null
    }
    return null
  }

  const { imported, errors } = bulkImportCSV(
    csvText, ['name', 'membership_number', 'phone', 'email', 'address', 'company', 'notes'],
    row => {
      const incoming = {
        name: row.name?.trim() || '',
        membership_number: cleanMembershipNumber(row.membership_number),
        phone: row.phone?.trim() || null,
        email: row.email?.trim() || null,
        address: row.address?.trim() || null,
        company: row.company?.trim() || null,
        notes: row.notes?.trim() || null,
      }

      const existing = findExisting(row)
      if (!existing) {
        const membershipNumber = assertUniqueMembershipNumber(incoming.membership_number)
        return insertCustomer.run(
          incoming.name,
          membershipNumber,
          incoming.phone,
          incoming.email,
          incoming.address,
          incoming.company,
          incoming.notes
        )
      }

      if (conflictMode === 'skip') return false

      if (conflictMode === 'overwrite') {
        const membershipNumber = assertUniqueMembershipNumber(incoming.membership_number || existing.membership_number, existing.id)
        return updateCustomer.run(
          incoming.name || existing.name,
          membershipNumber,
          incoming.phone,
          incoming.email,
          incoming.address,
          incoming.company,
          incoming.notes,
          existing.id
        )
      }

      // merge: keep existing populated values, fill only blanks with incoming values
      const merged = {
        name: existing.name || incoming.name,
        membership_number: existing.membership_number || incoming.membership_number,
        phone: existing.phone || incoming.phone,
        email: existing.email || incoming.email,
        address: existing.address || incoming.address,
        company: existing.company || incoming.company,
        notes: existing.notes || incoming.notes,
      }
      const membershipNumber = assertUniqueMembershipNumber(merged.membership_number, existing.id)
      if (
        merged.name === existing.name &&
        membershipNumber === existing.membership_number &&
        merged.phone === existing.phone &&
        merged.email === existing.email &&
        merged.address === existing.address &&
        merged.company === existing.company &&
        merged.notes === existing.notes
      ) return false

      return updateCustomer.run(
        merged.name,
        membershipNumber,
        merged.phone,
        merged.email,
        merged.address,
        merged.company,
        merged.notes,
        existing.id
      )
    }
  )
  audit(userId, userName, 'bulk_import', 'customer', null, { count: imported, conflictMode })
  broadcast('customers')
  ok(res, { imported, errors })
})

// ── Suppliers ─────────────────────────────────────────────────────────────────
router.get('/suppliers', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all())
})

router.post('/suppliers', authToken, (req, res) => {
  const d = req.body || {}
  if (!d.name?.trim()) return err(res, 'Name required')
  const r = db.prepare('INSERT INTO suppliers (name, phone, email, address, company, contact_person, notes) VALUES (?,?,?,?,?,?,?)')
    .run(d.name.trim(), d.phone || null, d.email || null, d.address || null, d.company || null, d.contact_person || null, d.notes || null)
  audit(d.userId, d.userName, 'create', 'supplier', r.lastInsertRowid, { name: d.name })
  broadcast('suppliers')
  ok(res, { id: r.lastInsertRowid })
})

router.put('/suppliers/:id', authToken, (req, res) => {
  const d = req.body || {}
  db.prepare('UPDATE suppliers SET name=?, phone=?, email=?, address=?, company=?, contact_person=?, notes=? WHERE id=?')
    .run(d.name, d.phone || null, d.email || null, d.address || null, d.company || null, d.contact_person || null, d.notes || null, req.params.id)
  broadcast('suppliers')
  ok(res, {})
})

router.delete('/suppliers/:id', authToken, (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id)
  broadcast('suppliers')
  ok(res, {})
})

router.post('/suppliers/bulk-import', authToken, (req, res) => {
  const { csvText, userId, userName } = req.body || {}
  const conflictMode = normalizeConflictMode(req.body?.conflictMode)
  const findByName = db.prepare(`
    SELECT *
    FROM suppliers
    WHERE lower(trim(name)) = lower(trim(?))
    LIMIT 1
  `)
  const findByPhone = db.prepare(`
    SELECT *
    FROM suppliers
    WHERE trim(coalesce(phone, '')) != ''
      AND trim(phone) = trim(?)
    LIMIT 1
  `)
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers (name, phone, email, address, company, contact_person, notes)
    VALUES (?,?,?,?,?,?,?)
  `)
  const updateSupplier = db.prepare(`
    UPDATE suppliers
    SET name = ?, phone = ?, email = ?, address = ?, company = ?, contact_person = ?, notes = ?
    WHERE id = ?
  `)

  const findExisting = (row) => {
    if (row.name?.trim()) {
      const byName = findByName.get(row.name)
      if (byName) return byName
    }
    if (row.phone?.trim()) {
      const byPhone = findByPhone.get(row.phone)
      if (byPhone) return byPhone
    }
    return null
  }

  const { imported, errors } = bulkImportCSV(
    csvText, ['name', 'phone', 'email', 'address', 'company', 'contact_person', 'notes'],
    row => {
      const incoming = {
        name: row.name?.trim() || '',
        phone: row.phone?.trim() || null,
        email: row.email?.trim() || null,
        address: row.address?.trim() || null,
        company: row.company?.trim() || null,
        contact_person: row.contact_person?.trim() || null,
        notes: row.notes?.trim() || null,
      }
      const existing = findExisting(row)
      if (!existing) {
        return insertSupplier.run(
          incoming.name,
          incoming.phone,
          incoming.email,
          incoming.address,
          incoming.company,
          incoming.contact_person,
          incoming.notes
        )
      }

      if (conflictMode === 'skip') return false

      if (conflictMode === 'overwrite') {
        return updateSupplier.run(
          incoming.name || existing.name,
          incoming.phone,
          incoming.email,
          incoming.address,
          incoming.company,
          incoming.contact_person,
          incoming.notes,
          existing.id
        )
      }

      const merged = {
        name: existing.name || incoming.name,
        phone: existing.phone || incoming.phone,
        email: existing.email || incoming.email,
        address: existing.address || incoming.address,
        company: existing.company || incoming.company,
        contact_person: existing.contact_person || incoming.contact_person,
        notes: existing.notes || incoming.notes,
      }
      if (
        merged.name === existing.name &&
        merged.phone === existing.phone &&
        merged.email === existing.email &&
        merged.address === existing.address &&
        merged.company === existing.company &&
        merged.contact_person === existing.contact_person &&
        merged.notes === existing.notes
      ) return false

      return updateSupplier.run(
        merged.name,
        merged.phone,
        merged.email,
        merged.address,
        merged.company,
        merged.contact_person,
        merged.notes,
        existing.id
      )
    }
  )
  audit(userId, userName, 'bulk_import', 'supplier', null, { count: imported, conflictMode })
  broadcast('suppliers')
  ok(res, { imported, errors })
})

// ── Delivery contacts ─────────────────────────────────────────────────────────
router.get('/delivery-contacts', authToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM delivery_contacts ORDER BY name').all())
})

router.post('/delivery-contacts', authToken, (req, res) => {
  const d = req.body || {}
  const name = String(d.name || '').trim()
  const phone = String(d.phone || '').trim()
  if (!name && !phone) return err(res, 'Driver name or phone is required')
  const finalName = name || `Driver ${phone}`
  const r = db.prepare('INSERT INTO delivery_contacts (name, phone, area, address, notes) VALUES (?,?,?,?,?)')
    .run(finalName, phone || null, d.area || null, d.address || null, d.notes || null)
  broadcast('deliveryContacts')
  ok(res, { id: r.lastInsertRowid })
})

router.put('/delivery-contacts/:id', authToken, (req, res) => {
  const d = req.body || {}
  const name = String(d.name || '').trim()
  const phone = String(d.phone || '').trim()
  if (!name && !phone) return err(res, 'Driver name or phone is required')
  const finalName = name || `Driver ${phone}`
  db.prepare('UPDATE delivery_contacts SET name=?, phone=?, area=?, address=?, notes=? WHERE id=?')
    .run(finalName, phone || null, d.area || null, d.address || null, d.notes || null, req.params.id)
  broadcast('deliveryContacts')
  ok(res, {})
})

router.delete('/delivery-contacts/:id', authToken, (req, res) => {
  db.prepare('DELETE FROM delivery_contacts WHERE id = ?').run(req.params.id)
  broadcast('deliveryContacts')
  ok(res, {})
})

router.post('/delivery-contacts/bulk-import', authToken, (req, res) => {
  const { csvText, userId, userName } = req.body || {}
  const conflictMode = normalizeConflictMode(req.body?.conflictMode)
  const findByName = db.prepare(`
    SELECT *
    FROM delivery_contacts
    WHERE lower(trim(name)) = lower(trim(?))
    LIMIT 1
  `)
  const findByPhone = db.prepare(`
    SELECT *
    FROM delivery_contacts
    WHERE trim(coalesce(phone, '')) != ''
      AND trim(phone) = trim(?)
    LIMIT 1
  `)
  const insertDelivery = db.prepare(`
    INSERT INTO delivery_contacts (name, phone, area, address, notes)
    VALUES (?,?,?,?,?)
  `)
  const updateDelivery = db.prepare(`
    UPDATE delivery_contacts
    SET name = ?, phone = ?, area = ?, address = ?, notes = ?
    WHERE id = ?
  `)

  const findExisting = (row) => {
    if (row.name?.trim()) {
      const byName = findByName.get(row.name)
      if (byName) return byName
    }
    if (row.phone?.trim()) {
      const byPhone = findByPhone.get(row.phone)
      if (byPhone) return byPhone
    }
    return null
  }

  const { imported, errors } = bulkImportCSV(
    csvText, ['name', 'phone', 'area', 'address', 'notes'],
    row => {
      const rawName = row.name?.trim() || ''
      const rawPhone = row.phone?.trim() || ''
      if (!rawName && !rawPhone) {
        throw new Error('Driver name or phone is required')
      }
      const finalName = rawName || `Driver ${rawPhone}`
      const incoming = {
        name: finalName,
        phone: rawPhone || null,
        area: row.area?.trim() || null,
        address: row.address?.trim() || null,
        notes: row.notes?.trim() || null,
      }
      const existing = findExisting(row)
      if (!existing) {
        return insertDelivery.run(
          incoming.name,
          incoming.phone,
          incoming.area,
          incoming.address,
          incoming.notes
        )
      }

      if (conflictMode === 'skip') return false

      if (conflictMode === 'overwrite') {
        return updateDelivery.run(
          incoming.name || existing.name,
          incoming.phone,
          incoming.area,
          incoming.address,
          incoming.notes,
          existing.id
        )
      }

      const merged = {
        name: existing.name || incoming.name,
        phone: existing.phone || incoming.phone,
        area: existing.area || incoming.area,
        address: existing.address || incoming.address,
        notes: existing.notes || incoming.notes,
      }
      if (
        merged.name === existing.name &&
        merged.phone === existing.phone &&
        merged.area === existing.area &&
        merged.address === existing.address &&
        merged.notes === existing.notes
      ) return false

      return updateDelivery.run(
        merged.name,
        merged.phone,
        merged.area,
        merged.address,
        merged.notes,
        existing.id
      )
    }
  )
  audit(userId, userName, 'bulk_import', 'delivery_contact', null, { count: imported, conflictMode })
  broadcast('deliveryContacts')
  ok(res, { imported, errors })
})

module.exports = router
