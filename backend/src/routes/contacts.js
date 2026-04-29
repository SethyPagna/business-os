'use strict'
const express = require('express')
const { db }  = require('../database')
const { ok, err, audit, broadcast, parseCSVRows } = require('../helpers')
const { authToken, requirePermission, getAuditActor } = require('../middleware')
const { WriteConflictError, assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')

const router = express.Router()
const CONTACT_OPTION_LIMIT = 3

function cleanText(value) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeContactOption(option = {}, { mode = 'address' } = {}) {
  return {
    label: cleanText(option.label),
    name: cleanText(option.name),
    phone: cleanText(option.phone),
    email: mode === 'area' ? null : cleanText(option.email),
    address: mode === 'area' ? null : cleanText(option.address),
    area: mode === 'area' ? cleanText(option.area) : null,
  }
}

function hasContactOptionData(option = {}, { mode = 'address' } = {}) {
  const keys = mode === 'area'
    ? ['label', 'name', 'phone', 'area']
    : ['label', 'name', 'phone', 'email', 'address']
  return keys.some((key) => cleanText(option?.[key]))
}

function parseStoredContactOptions(raw, { mode = 'address' } = {}) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      if (typeof parsed[0] === 'object' && parsed[0] !== null) {
        return parsed
          .map((entry) => normalizeContactOption(entry, { mode }))
          .filter((entry) => hasContactOptionData(entry, { mode }))
          .slice(0, CONTACT_OPTION_LIMIT)
      }
      const legacyKey = mode === 'area' ? 'area' : 'address'
      return parsed
        .map((entry, index) => normalizeContactOption({
          label: index === 0 ? 'Default' : `Option ${index + 1}`,
          [legacyKey]: entry,
        }, { mode }))
        .filter((entry) => hasContactOptionData(entry, { mode }))
        .slice(0, CONTACT_OPTION_LIMIT)
    }
  } catch (_) {}
  const legacyKey = mode === 'area' ? 'area' : 'address'
  return [normalizeContactOption({
    label: 'Default',
    [legacyKey]: raw,
  }, { mode })].filter((entry) => hasContactOptionData(entry, { mode }))
}

function parseImportContactOptions(row = {}, { mode = 'address' } = {}) {
  const valueField = mode === 'area' ? 'area' : 'address'
  const options = []
  for (let index = 1; index <= CONTACT_OPTION_LIMIT; index += 1) {
    const option = normalizeContactOption({
      label: row[`contact_label_${index}`],
      name: row[`contact_name_${index}`],
      phone: row[`contact_phone_${index}`],
      email: mode === 'area' ? null : row[`contact_email_${index}`],
      [valueField]: row[`contact_${valueField}_${index}`],
    }, { mode })
    if (hasContactOptionData(option, { mode })) options.push(option)
  }
  return options.slice(0, CONTACT_OPTION_LIMIT)
}

function serializeContactOptions(options = [], { mode = 'address' } = {}) {
  const clean = (Array.isArray(options) ? options : [])
    .map((entry) => normalizeContactOption(entry, { mode }))
    .filter((entry) => hasContactOptionData(entry, { mode }))
    .slice(0, CONTACT_OPTION_LIMIT)
  return clean.length ? JSON.stringify(clean) : null
}

function getPrimaryContactOption(options = [], { mode = 'address' } = {}) {
  const found = (Array.isArray(options) ? options : []).find((entry) => hasContactOptionData(entry, { mode }))
  return found ? normalizeContactOption(found, { mode }) : normalizeContactOption({}, { mode })
}

function buildImportedContactState(source = {}, { mode = 'address' } = {}) {
  const importedOptions = parseImportContactOptions(source, { mode })
  const storedOptions = importedOptions.length
    ? importedOptions
    : parseStoredContactOptions(source.address, { mode })
  if (!storedOptions.length) {
    const fallback = normalizeContactOption({
      name: source.contact_person || source.name,
      phone: source.phone,
      email: source.email,
      [mode === 'area' ? 'area' : 'address']: mode === 'area' ? source.area : source.address,
    }, { mode })
    if (hasContactOptionData(fallback, { mode })) storedOptions.push(fallback)
  }
  const primary = getPrimaryContactOption(storedOptions, { mode })
  return {
    options: storedOptions.slice(0, CONTACT_OPTION_LIMIT),
    serialized: serializeContactOptions(storedOptions, { mode }),
    primary,
  }
}

function cleanMembershipNumber(value) {
  return cleanText(value)
}

function requireMembershipNumber(value) {
  const normalized = cleanMembershipNumber(value)
  if (!normalized) throw new Error('Membership number is required')
  return normalized
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

function ensureMembershipNumber(value, excludeId = null) {
  const normalized = requireMembershipNumber(value)
  return assertUniqueMembershipNumber(normalized, excludeId)
}

function normalizeFieldRule(value, fallback) {
  const rule = String(value || fallback || '').trim().toLowerCase()
  return ['keep_existing', 'use_imported', 'merge_blank_only', 'clear_value'].includes(rule)
    ? rule
    : fallback
}

function resolveFieldValue(existingValue, incomingValue, rule, { defaultRule = 'merge_blank_only' } = {}) {
  const effectiveRule = normalizeFieldRule(rule, defaultRule)
  const existing = existingValue ?? null
  const incoming = incomingValue ?? null

  if (effectiveRule === 'clear_value') return null
  if (effectiveRule === 'use_imported') return incoming
  if (effectiveRule === 'keep_existing') return existing
  return existing || incoming
}

function buildImportRows(payload = {}) {
  if (Array.isArray(payload.rows)) {
    return {
      rows: payload.rows.map((row, index) => ({ row, rowNumber: Number(row?._rowNumber) || index + 2 })),
      errors: [],
    }
  }
  return parseCSVRows(payload.csvText)
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
router.get('/customers', authToken, requirePermission('contacts'), (req, res) => {
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

router.post('/customers', authToken, requirePermission('contacts'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  if (!d.name?.trim()) return err(res, 'Name required')
  if (!cleanMembershipNumber(d.membership_number)) return err(res, 'Membership number is required')
  try {
    const membershipNumber = ensureMembershipNumber(d.membership_number)
    const r = db.prepare('INSERT INTO customers (name, membership_number, phone, email, address, company, notes, updated_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'))')
      .run(d.name.trim(), membershipNumber, d.phone || null, d.email || null, d.address || null, d.company || null, d.notes || null)
    audit(actor.userId, actor.userName, 'create', 'customer', r.lastInsertRowid, { name: d.name })
    broadcast('customers')
    ok(res, { id: r.lastInsertRowid })
  } catch (e) { err(res, e.message) }
})

router.put('/customers/:id', authToken, requirePermission('contacts'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  try {
    const current = db.prepare('SELECT id, updated_at FROM customers WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Customer not found', 404)
    assertUpdatedAtMatch('customer', current, getExpectedUpdatedAt(d))
    if (!String(d.name || '').trim()) return err(res, 'Name required')
    if (!cleanMembershipNumber(d.membership_number)) return err(res, 'Membership number is required')
    const membershipNumber = ensureMembershipNumber(d.membership_number, parseInt(req.params.id, 10))
    db.prepare('UPDATE customers SET name=?, membership_number=?, phone=?, email=?, address=?, company=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(d.name, membershipNumber, d.phone || null, d.email || null, d.address || null, d.company || null, d.notes || null, req.params.id)
    audit(actor.userId, actor.userName, 'update', 'customer', req.params.id)
    broadcast('customers')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.delete('/customers/:id', authToken, requirePermission('contacts'), (req, res) => {
  try {
    const actor = getAuditActor(req)
    const current = db.prepare('SELECT id, name, updated_at FROM customers WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Customer not found', 404)
    assertUpdatedAtMatch('customer', current, getExpectedUpdatedAt(req.body || req.query || {}))
    db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'customer', req.params.id, { name: current.name || null })
    broadcast('customers')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.post('/customers/bulk-import', authToken, requirePermission('contacts'), (req, res) => {
  const payload = req.body || {}
  const actor = getAuditActor(req)
  const conflictMode = normalizeConflictMode(payload?.conflictMode)
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
    SET name = ?, membership_number = ?, phone = ?, email = ?, address = ?, company = ?, notes = ?, updated_at = datetime('now')
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

  const parsed = buildImportRows(payload)
  if (parsed.errors.length) return ok(res, { imported: 0, errors: parsed.errors })

  let imported = 0
  const errors = []

  db.transaction(() => {
    for (const entry of parsed.rows) {
      const row = entry.row || {}
      const rowNumber = entry.rowNumber
      if (!String(row.name || '').trim()) {
        errors.push(`Row ${rowNumber}: name is required`)
        continue
      }
      if (!cleanMembershipNumber(row.membership_number)) {
        errors.push(`Row ${rowNumber}: membership number is required`)
        continue
      }

      try {
        const rowConflictMode = normalizeConflictMode(row._conflict_mode || conflictMode)
        const rowFieldRules = row._field_rules && typeof row._field_rules === 'object' ? row._field_rules : {}
        const contactState = buildImportedContactState(row, { mode: 'address' })
        const incoming = {
          name: row.name?.trim() || '',
          membership_number: cleanMembershipNumber(row.membership_number),
          phone: cleanText(contactState.primary.phone || row.phone),
          email: cleanText(contactState.primary.email || row.email),
          address: contactState.serialized || cleanText(row.address),
          company: row.company?.trim() || null,
          notes: row.notes?.trim() || null,
        }

        const existing = findExisting(row)
        if (!existing) {
          const membershipNumber = ensureMembershipNumber(incoming.membership_number)
          const result = insertCustomer.run(
            incoming.name,
            membershipNumber,
            incoming.phone,
            incoming.email,
            incoming.address,
            incoming.company,
            incoming.notes
          )
          if (result?.changes) imported += 1
          continue
        }

        if (rowConflictMode === 'skip') continue

        const defaultRule = rowConflictMode === 'overwrite' ? 'use_imported' : 'merge_blank_only'
        const merged = {
          name: resolveFieldValue(existing.name, incoming.name, rowFieldRules.name, { defaultRule }),
          membership_number: resolveFieldValue(existing.membership_number, incoming.membership_number, rowFieldRules.membership_number, { defaultRule }),
          phone: resolveFieldValue(existing.phone, incoming.phone, rowFieldRules.phone, { defaultRule }),
          email: resolveFieldValue(existing.email, incoming.email, rowFieldRules.email, { defaultRule }),
          address: resolveFieldValue(existing.address, incoming.address, rowFieldRules.address, { defaultRule }),
          contact_options: resolveFieldValue(existing.address, incoming.address, rowFieldRules.contact_options, { defaultRule }),
          company: resolveFieldValue(existing.company, incoming.company, rowFieldRules.company, { defaultRule }),
          notes: resolveFieldValue(existing.notes, incoming.notes, rowFieldRules.notes, { defaultRule }),
        }
        if (!String(merged.name || '').trim()) {
          throw new Error('name is required after conflict handling')
        }
        const membershipNumber = ensureMembershipNumber(merged.membership_number, existing.id)
        const mergedAddress = merged.contact_options ?? merged.address
        if (
          merged.name === existing.name &&
          membershipNumber === existing.membership_number &&
          (merged.phone || null) === (existing.phone || null) &&
          (merged.email || null) === (existing.email || null) &&
          (mergedAddress || null) === (existing.address || null) &&
          (merged.company || null) === (existing.company || null) &&
          (merged.notes || null) === (existing.notes || null)
        ) continue

        const result = updateCustomer.run(
          merged.name,
          membershipNumber,
          merged.phone,
          merged.email,
          mergedAddress,
          merged.company,
          merged.notes,
          existing.id
        )
        if (result?.changes) imported += 1
      } catch (error) {
        errors.push(`Row ${rowNumber}: ${error.message}`)
      }
    }
  })()
  audit(actor.userId, actor.userName, 'bulk_import', 'customer', null, { count: imported, conflictMode })
  broadcast('customers')
  ok(res, { imported, errors })
})

// ── Suppliers ─────────────────────────────────────────────────────────────────
router.get('/suppliers', authToken, requirePermission('contacts'), (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all())
})

router.post('/suppliers', authToken, requirePermission('contacts'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  if (!d.name?.trim()) return err(res, 'Name required')
  const contactState = buildImportedContactState(d, { mode: 'address' })
  const r = db.prepare('INSERT INTO suppliers (name, phone, email, address, company, contact_person, notes, updated_at) VALUES (?,?,?,?,?,?,?,datetime(\'now\'))')
    .run(
      d.name.trim(),
      contactState.primary.phone || cleanText(d.phone),
      contactState.primary.email || cleanText(d.email),
      contactState.serialized || cleanText(d.address),
      cleanText(d.company),
      contactState.primary.name || cleanText(d.contact_person),
      cleanText(d.notes),
    )
  audit(actor.userId, actor.userName, 'create', 'supplier', r.lastInsertRowid, { name: d.name })
  broadcast('suppliers')
  ok(res, { id: r.lastInsertRowid })
})

router.put('/suppliers/:id', authToken, requirePermission('contacts'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  try {
    const current = db.prepare('SELECT id, updated_at FROM suppliers WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Supplier not found', 404)
    assertUpdatedAtMatch('supplier', current, getExpectedUpdatedAt(d))
    const contactState = buildImportedContactState(d, { mode: 'address' })
    db.prepare('UPDATE suppliers SET name=?, phone=?, email=?, address=?, company=?, contact_person=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(
        d.name,
        contactState.primary.phone || cleanText(d.phone),
        contactState.primary.email || cleanText(d.email),
        contactState.serialized || cleanText(d.address),
        cleanText(d.company),
        contactState.primary.name || cleanText(d.contact_person),
        cleanText(d.notes),
        req.params.id,
      )
    audit(actor.userId, actor.userName, 'update', 'supplier', req.params.id, { name: d.name || null })
    broadcast('suppliers')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.delete('/suppliers/:id', authToken, requirePermission('contacts'), (req, res) => {
  try {
    const actor = getAuditActor(req)
    const current = db.prepare('SELECT id, name, updated_at FROM suppliers WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Supplier not found', 404)
    assertUpdatedAtMatch('supplier', current, getExpectedUpdatedAt(req.body || req.query || {}))
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'supplier', req.params.id, { name: current.name || null })
    broadcast('suppliers')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.post('/suppliers/bulk-import', authToken, requirePermission('contacts'), (req, res) => {
  const payload = req.body || {}
  const actor = getAuditActor(req)
  const conflictMode = normalizeConflictMode(payload?.conflictMode)
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
    SET name = ?, phone = ?, email = ?, address = ?, company = ?, contact_person = ?, notes = ?, updated_at = datetime('now')
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

  const parsed = buildImportRows(payload)
  if (parsed.errors.length) return ok(res, { imported: 0, errors: parsed.errors })
  let imported = 0
  const errors = []

  db.transaction(() => {
    for (const entry of parsed.rows) {
      const row = entry.row || {}
      const rowNumber = entry.rowNumber
      if (!String(row.name || '').trim()) {
        errors.push(`Row ${rowNumber}: name is required`)
        continue
      }
      try {
        const rowConflictMode = normalizeConflictMode(row._conflict_mode || conflictMode)
        const rowFieldRules = row._field_rules && typeof row._field_rules === 'object' ? row._field_rules : {}
        const contactState = buildImportedContactState(row, { mode: 'address' })
        const incoming = {
          name: row.name?.trim() || '',
          phone: contactState.primary.phone || cleanText(row.phone),
          email: contactState.primary.email || cleanText(row.email),
          address: contactState.serialized || cleanText(row.address),
          company: row.company?.trim() || null,
          contact_person: contactState.primary.name || cleanText(row.contact_person),
          notes: row.notes?.trim() || null,
        }
        const existing = findExisting(row)
        if (!existing) {
          const result = insertSupplier.run(
            incoming.name,
            incoming.phone,
            incoming.email,
            incoming.address,
            incoming.company,
            incoming.contact_person,
            incoming.notes
          )
          if (result?.changes) imported += 1
          continue
        }
        if (rowConflictMode === 'skip') continue
        const defaultRule = rowConflictMode === 'overwrite' ? 'use_imported' : 'merge_blank_only'
        const merged = {
          name: resolveFieldValue(existing.name, incoming.name, rowFieldRules.name, { defaultRule }),
          phone: resolveFieldValue(existing.phone, incoming.phone, rowFieldRules.phone, { defaultRule }),
          email: resolveFieldValue(existing.email, incoming.email, rowFieldRules.email, { defaultRule }),
          address: resolveFieldValue(existing.address, incoming.address, rowFieldRules.address, { defaultRule }),
          contact_options: resolveFieldValue(existing.address, incoming.address, rowFieldRules.contact_options, { defaultRule }),
          company: resolveFieldValue(existing.company, incoming.company, rowFieldRules.company, { defaultRule }),
          contact_person: resolveFieldValue(existing.contact_person, incoming.contact_person, rowFieldRules.contact_person, { defaultRule }),
          notes: resolveFieldValue(existing.notes, incoming.notes, rowFieldRules.notes, { defaultRule }),
        }
        if (!String(merged.name || '').trim()) throw new Error('name is required after conflict handling')
        const mergedAddress = merged.contact_options ?? merged.address
        if (
          merged.name === existing.name &&
          (merged.phone || null) === (existing.phone || null) &&
          (merged.email || null) === (existing.email || null) &&
          (mergedAddress || null) === (existing.address || null) &&
          (merged.company || null) === (existing.company || null) &&
          (merged.contact_person || null) === (existing.contact_person || null) &&
          (merged.notes || null) === (existing.notes || null)
        ) continue
        const result = updateSupplier.run(
          merged.name,
          merged.phone,
          merged.email,
          mergedAddress,
          merged.company,
          merged.contact_person,
          merged.notes,
          existing.id
        )
        if (result?.changes) imported += 1
      } catch (error) {
        errors.push(`Row ${rowNumber}: ${error.message}`)
      }
    }
  })()
  audit(actor.userId, actor.userName, 'bulk_import', 'supplier', null, { count: imported, conflictMode })
  broadcast('suppliers')
  ok(res, { imported, errors })
})

// ── Delivery contacts ─────────────────────────────────────────────────────────
router.get('/delivery-contacts', authToken, requirePermission('contacts'), (req, res) => {
  res.json(db.prepare('SELECT * FROM delivery_contacts ORDER BY name').all())
})

router.post('/delivery-contacts', authToken, requirePermission('contacts'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  const contactState = buildImportedContactState(d, { mode: 'area' })
  const name = cleanText(contactState.primary.name || d.name) || ''
  const phone = cleanText(contactState.primary.phone || d.phone) || ''
  const area = cleanText(contactState.primary.area || d.area)
  if (!name && !phone) return err(res, 'Driver name or phone is required')
  const finalName = name || `Driver ${phone}`
  const r = db.prepare('INSERT INTO delivery_contacts (name, phone, area, address, notes, updated_at) VALUES (?,?,?,?,?,datetime(\'now\'))')
    .run(finalName, phone || null, area || null, contactState.serialized || cleanText(d.address), cleanText(d.notes))
  audit(actor.userId, actor.userName, 'create', 'delivery_contact', r.lastInsertRowid, { name: finalName })
  broadcast('deliveryContacts')
  ok(res, { id: r.lastInsertRowid })
})

router.put('/delivery-contacts/:id', authToken, requirePermission('contacts'), (req, res) => {
  const d = req.body || {}
  const actor = getAuditActor(req)
  const contactState = buildImportedContactState(d, { mode: 'area' })
  const name = cleanText(contactState.primary.name || d.name) || ''
  const phone = cleanText(contactState.primary.phone || d.phone) || ''
  const area = cleanText(contactState.primary.area || d.area)
  if (!name && !phone) return err(res, 'Driver name or phone is required')
  const finalName = name || `Driver ${phone}`
  try {
    const current = db.prepare('SELECT id, updated_at FROM delivery_contacts WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Delivery contact not found', 404)
    assertUpdatedAtMatch('delivery contact', current, getExpectedUpdatedAt(d))
    db.prepare('UPDATE delivery_contacts SET name=?, phone=?, area=?, address=?, notes=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(finalName, phone || null, area || null, contactState.serialized || cleanText(d.address), cleanText(d.notes), req.params.id)
    audit(actor.userId, actor.userName, 'update', 'delivery_contact', req.params.id, { name: finalName })
    broadcast('deliveryContacts')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.delete('/delivery-contacts/:id', authToken, requirePermission('contacts'), (req, res) => {
  try {
    const actor = getAuditActor(req)
    const current = db.prepare('SELECT id, name, updated_at FROM delivery_contacts WHERE id = ?').get(req.params.id)
    if (!current) return err(res, 'Delivery contact not found', 404)
    assertUpdatedAtMatch('delivery contact', current, getExpectedUpdatedAt(req.body || req.query || {}))
    db.prepare('DELETE FROM delivery_contacts WHERE id = ?').run(req.params.id)
    audit(actor.userId, actor.userName, 'delete', 'delivery_contact', req.params.id, { name: current.name || null })
    broadcast('deliveryContacts')
    ok(res, {})
  } catch (e) {
    if (e instanceof WriteConflictError) return sendWriteConflict(res, e)
    err(res, e.message)
  }
})

router.post('/delivery-contacts/bulk-import', authToken, requirePermission('contacts'), (req, res) => {
  const payload = req.body || {}
  const actor = getAuditActor(req)
  const conflictMode = normalizeConflictMode(payload?.conflictMode)
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
    SET name = ?, phone = ?, area = ?, address = ?, notes = ?, updated_at = datetime('now')
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

  const parsed = buildImportRows(payload)
  if (parsed.errors.length) return ok(res, { imported: 0, errors: parsed.errors })
  let imported = 0
  const errors = []

  db.transaction(() => {
    for (const entry of parsed.rows) {
      const row = entry.row || {}
      const rowNumber = entry.rowNumber
      try {
        const contactState = buildImportedContactState(row, { mode: 'area' })
        const rawName = cleanText(contactState.primary.name || row.name) || ''
        const rawPhone = cleanText(contactState.primary.phone || row.phone) || ''
        const rawArea = cleanText(contactState.primary.area || row.area)
        if (!rawName && !rawPhone) throw new Error('Driver name or phone is required')
        const rowConflictMode = normalizeConflictMode(row._conflict_mode || conflictMode)
        const rowFieldRules = row._field_rules && typeof row._field_rules === 'object' ? row._field_rules : {}
        const finalName = rawName || `Driver ${rawPhone}`
        const incoming = {
          name: finalName,
          phone: rawPhone || null,
          area: rawArea,
          address: contactState.serialized || cleanText(row.address),
          contact_options: contactState.serialized || cleanText(row.address),
          notes: row.notes?.trim() || null,
        }
        const existing = findExisting(row)
        if (!existing) {
          const result = insertDelivery.run(
            incoming.name,
            incoming.phone,
            incoming.area,
            incoming.address,
            incoming.notes
          )
          if (result?.changes) imported += 1
          continue
        }
        if (rowConflictMode === 'skip') continue
        const defaultRule = rowConflictMode === 'overwrite' ? 'use_imported' : 'merge_blank_only'
        const merged = {
          name: resolveFieldValue(existing.name, incoming.name, rowFieldRules.name, { defaultRule }),
          phone: resolveFieldValue(existing.phone, incoming.phone, rowFieldRules.phone, { defaultRule }),
          area: resolveFieldValue(existing.area, incoming.area, rowFieldRules.area, { defaultRule }),
          address: resolveFieldValue(existing.address, incoming.address, rowFieldRules.address, { defaultRule }),
          contact_options: resolveFieldValue(existing.address, incoming.address, rowFieldRules.contact_options, { defaultRule }),
          notes: resolveFieldValue(existing.notes, incoming.notes, rowFieldRules.notes, { defaultRule }),
        }
        if (!String(merged.name || '').trim() && !String(merged.phone || '').trim()) {
          throw new Error('Driver name or phone is required after conflict handling')
        }
        const mergedAddress = merged.contact_options ?? merged.address
        const result = updateDelivery.run(
          merged.name || `Driver ${merged.phone}`,
          merged.phone,
          merged.area,
          mergedAddress,
          merged.notes,
          existing.id
        )
        if (result?.changes) imported += 1
      } catch (error) {
        errors.push(`Row ${rowNumber}: ${error.message}`)
      }
    }
  })()
  audit(actor.userId, actor.userName, 'bulk_import', 'delivery_contact', null, { count: imported, conflictMode })
  broadcast('deliveryContacts')
  ok(res, { imported, errors })
})

module.exports = router
