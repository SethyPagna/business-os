function normalizeMovementTimeValue(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const normalizedBase = raw.includes('T') ? raw : raw.replace(' ', 'T')
  if (/Z$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{2}:\d{2}$/i.test(normalizedBase)) return normalizedBase
  if (/[+-]\d{4}$/i.test(normalizedBase)) {
    return normalizedBase.replace(/([+-]\d{2})(\d{2})$/i, '$1:$2')
  }
  if (/[+-]\d{2}$/i.test(normalizedBase)) return `${normalizedBase}:00`
  return `${normalizedBase}Z`
}

function minuteBucket(value) {
  const normalized = normalizeMovementTimeValue(value)
  const date = new Date(normalized || Date.now())
  if (Number.isNaN(date.getTime())) return 'unknown'
  date.setSeconds(0, 0)
  return date.toISOString()
}

function normalizeText(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ')
  const lowered = raw.toLowerCase()
  if (!raw || lowered === 'undefined' || lowered === 'null' || lowered === 'nan') return ''
  return raw
}

function canonicalMovementType(type) {
  const key = String(type || '').toLowerCase()
  if (key === 'transfer_in' || key === 'transfer_out') return 'transfer'
  return key
}

function buildGroupKey(movement) {
  const normalizedType = canonicalMovementType(movement.movement_type)
  const referenceId = movement.reference_id ? `ref:${movement.reference_id}` : ''
  if (referenceId) return `${normalizedType}|${referenceId}`

  const reason = normalizeText(movement.reason)
  const user = normalizeText(movement.user_id || movement.user_name)
  const time = minuteBucket(movement.created_at)

  if (reason) return `${normalizedType}|reason:${reason}|user:${user}|time:${time}`
  if (['purchase', 'adjustment', 'supplier_return', 'return_reversal', 'transfer'].includes(normalizedType)) {
    return `${normalizedType}|user:${user}|time:${time}`
  }
  return `${normalizedType}|id:${movement.id}`
}

function describeMovementType(type) {
  const key = String(type || '').toLowerCase()
  const labels = {
    row_move_in: 'row move in',
    row_move_out: 'row move out',
    csv_import: 'CSV import',
  }
  if (labels[key]) return labels[key]
  return key.replace(/_/g, ' ')
}

function movementSign(type) {
  const key = String(type || '').toLowerCase()
  if (['remove', 'sale', 'supplier_return', 'return_reversal', 'transfer_out', 'row_move_out', 'write_off'].includes(key)) return -1
  return 1
}

function movementSignedValue(movement, field) {
  const value = Number(movement?.[field] || 0)
  if (!Number.isFinite(value)) return 0
  return Math.abs(value) * movementSign(movement?.movement_type)
}

function parseMovementTime(value) {
  const normalized = normalizeMovementTimeValue(value)
  if (!normalized) return null
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function normalizeMovementTimestamp(movement = {}) {
  const candidates = [
    movement.movement_date,
    movement.date,
    movement.imported_at,
    movement.created_at,
  ]
  for (const candidate of candidates) {
    const raw = String(candidate || '').trim()
    if (!raw || raw.toLowerCase() === 'invalid date') continue
    if (parseMovementTime(raw)) return raw
  }
  return String(movement.created_at || '').trim() || null
}

export function buildMovementGroups(movements = []) {
  const groups = new Map()

  for (const movement of Array.isArray(movements) ? movements : []) {
    const normalizedMovement = {
      ...movement,
      created_at: normalizeMovementTimestamp(movement),
    }
    const key = buildGroupKey(normalizedMovement)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        id: key,
        movement_type: canonicalMovementType(normalizedMovement.movement_type) || 'adjustment',
        movementLabel: describeMovementType(canonicalMovementType(normalizedMovement.movement_type)),
        created_at: normalizedMovement.created_at,
        latest_at: normalizedMovement.created_at,
        reference_id: normalizedMovement.reference_id || null,
        reason: normalizeText(normalizedMovement.reason),
        branch_name: normalizeText(normalizedMovement.branch_name),
        user_name: normalizeText(normalizedMovement.user_name),
        totalQuantity: movementSignedValue(normalizedMovement, 'quantity'),
        totalCostUsd: movementSignedValue(normalizedMovement, 'total_cost_usd'),
        totalCostKhr: movementSignedValue(normalizedMovement, 'total_cost_khr'),
        items: [normalizedMovement],
      })
      continue
    }

    existing.items.push(normalizedMovement)
    existing.totalQuantity += movementSignedValue(normalizedMovement, 'quantity')
    existing.totalCostUsd += movementSignedValue(normalizedMovement, 'total_cost_usd')
    existing.totalCostKhr += movementSignedValue(normalizedMovement, 'total_cost_khr')

    const created = parseMovementTime(normalizedMovement.created_at)
    const earliest = parseMovementTime(existing.created_at)
    const latest = parseMovementTime(existing.latest_at)
    if (created && (!earliest || created < earliest)) existing.created_at = normalizedMovement.created_at
    if (created && (!latest || created > latest)) existing.latest_at = normalizedMovement.created_at

    if (!existing.reason && normalizedMovement.reason) existing.reason = normalizeText(normalizedMovement.reason)
    if (!existing.branch_name && normalizedMovement.branch_name) existing.branch_name = normalizeText(normalizedMovement.branch_name)
    if (!existing.user_name && normalizedMovement.user_name) existing.user_name = normalizeText(normalizedMovement.user_name)
  }

  return Array.from(groups.values())
    .map((group) => {
      const uniqueProducts = Array.from(new Set(group.items.map((item) => {
        const displayName = normalizeText(item.product_name)
        if (displayName) return displayName
        const lotCode = normalizeText(item.lot_code)
        if (lotCode) return `Lot ${lotCode}`
        const productId = Number(item.product_id || 0)
        if (Number.isFinite(productId) && productId > 0) return `product #${productId}`
        return 'Inventory movement'
      }).filter(Boolean)))
      const uniqueBranches = Array.from(new Set(group.items.map((item) => normalizeText(item.branch_name)).filter(Boolean)))
      const uniqueUsers = Array.from(new Set(group.items.map((item) => normalizeText(item.user_name)).filter(Boolean)))
      const allReasons = Array.from(new Set(group.items.map((item) => normalizeText(item.reason)).filter(Boolean)))

      return {
        ...group,
        recordCount: group.items.length,
        productCount: uniqueProducts.length,
        productNames: uniqueProducts,
        productSummary: uniqueProducts.length <= 2 ? uniqueProducts.join(', ') : `${uniqueProducts.slice(0, 2).join(', ')} +${uniqueProducts.length - 2}`,
        branchSummary: uniqueBranches.length <= 1 ? (uniqueBranches[0] || '') : `${uniqueBranches[0]} +${uniqueBranches.length - 1}`,
        userSummary: uniqueUsers.length <= 1 ? (uniqueUsers[0] || '') : `${uniqueUsers[0]} +${uniqueUsers.length - 1}`,
        reasonSummary: allReasons[0] || '',
      }
    })
    .sort((a, b) => {
      const left = parseMovementTime(a.latest_at)?.getTime() || 0
      const right = parseMovementTime(b.latest_at)?.getTime() || 0
      return right - left
    })
}

export function getMovementGroupPage(group, { page = 1, pageSize = 10 } = {}) {
  const safePage = Math.max(1, Number(page || 1) || 1)
  const safePageSize = Math.max(1, Number(pageSize || 10) || 10)
  const items = Array.isArray(group?.items) ? group.items : []
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize))
  const currentPage = Math.min(safePage, totalPages)
  const offset = (currentPage - 1) * safePageSize
  return {
    items: items.slice(offset, offset + safePageSize),
    page: currentPage,
    pageSize: safePageSize,
    total: items.length,
    totalPages,
  }
}

export function movementGroupHaystack(group) {
  return [
    group.movement_type,
    group.movementLabel,
    group.productSummary,
    group.branchSummary,
    group.userSummary,
    group.reasonSummary,
    group.reference_id,
    group.latest_at,
    ...(group.productNames || []),
    ...(group.items || []).flatMap((item) => [item.lot_code, item.expiry_date, item.created_at]),
  ].map((value) => String(value || '').toLowerCase()).join(' ')
}
