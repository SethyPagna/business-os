function minuteBucket(value) {
  const raw = String(value || '').trim()
  const normalized = raw ? (raw.includes('T') || raw.endsWith('Z') ? raw : `${raw.replace(' ', 'T')}Z`) : ''
  const date = new Date(normalized || Date.now())
  if (Number.isNaN(date.getTime())) return 'unknown'
  date.setSeconds(0, 0)
  return date.toISOString()
}

function normalizeText(value) {
  return String(value || '').trim()
}

function buildGroupKey(movement) {
  const referenceId = movement.reference_id ? `ref:${movement.reference_id}` : ''
  if (referenceId) return `${movement.movement_type}|${referenceId}`

  const reason = normalizeText(movement.reason)
  const user = normalizeText(movement.user_id || movement.user_name)
  const time = minuteBucket(movement.created_at)

  if (reason) return `${movement.movement_type}|reason:${reason}|user:${user}|time:${time}`
  if (['purchase', 'adjustment', 'supplier_return', 'return_reversal', 'transfer'].includes(String(movement.movement_type || '').toLowerCase())) {
    return `${movement.movement_type}|user:${user}|time:${time}`
  }
  return `${movement.movement_type}|id:${movement.id}`
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
  if (!value) return null
  const raw = String(value).trim()
  const date = new Date(raw.includes('T') || raw.endsWith('Z') ? raw : raw.replace(' ', 'T') + 'Z')
  return Number.isNaN(date.getTime()) ? null : date
}

export function buildMovementGroups(movements = []) {
  const groups = new Map()

  for (const movement of Array.isArray(movements) ? movements : []) {
    const key = buildGroupKey(movement)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        id: key,
        movement_type: movement.movement_type || 'adjustment',
        movementLabel: describeMovementType(movement.movement_type),
        created_at: movement.created_at,
        latest_at: movement.created_at,
        reference_id: movement.reference_id || null,
        reason: normalizeText(movement.reason),
        branch_name: normalizeText(movement.branch_name),
        user_name: normalizeText(movement.user_name),
        totalQuantity: movementSignedValue(movement, 'quantity'),
        totalCostUsd: movementSignedValue(movement, 'total_cost_usd'),
        totalCostKhr: movementSignedValue(movement, 'total_cost_khr'),
        items: [movement],
      })
      continue
    }

    existing.items.push(movement)
    existing.totalQuantity += movementSignedValue(movement, 'quantity')
    existing.totalCostUsd += movementSignedValue(movement, 'total_cost_usd')
    existing.totalCostKhr += movementSignedValue(movement, 'total_cost_khr')

    const created = parseMovementTime(movement.created_at)
    const earliest = parseMovementTime(existing.created_at)
    const latest = parseMovementTime(existing.latest_at)
    if (created && (!earliest || created < earliest)) existing.created_at = movement.created_at
    if (created && (!latest || created > latest)) existing.latest_at = movement.created_at

    if (!existing.reason && movement.reason) existing.reason = normalizeText(movement.reason)
    if (!existing.branch_name && movement.branch_name) existing.branch_name = normalizeText(movement.branch_name)
    if (!existing.user_name && movement.user_name) existing.user_name = normalizeText(movement.user_name)
  }

  return Array.from(groups.values())
    .map((group) => {
      const uniqueProducts = Array.from(new Set(group.items.map((item) => normalizeText(item.product_name)).filter(Boolean)))
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

export function movementGroupHaystack(group) {
  return [
    group.movement_type,
    group.movementLabel,
    group.productSummary,
    group.branchSummary,
    group.userSummary,
    group.reasonSummary,
    group.reference_id,
    ...(group.productNames || []),
  ].map((value) => String(value || '').toLowerCase()).join(' ')
}
