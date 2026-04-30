function minuteBucket(value) {
  const date = new Date(value || Date.now())
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
        totalQuantity: Number(movement.quantity || 0),
        totalCostUsd: Number(movement.total_cost_usd || 0),
        totalCostKhr: Number(movement.total_cost_khr || 0),
        items: [movement],
      })
      continue
    }

    existing.items.push(movement)
    existing.totalQuantity += Number(movement.quantity || 0)
    existing.totalCostUsd += Number(movement.total_cost_usd || 0)
    existing.totalCostKhr += Number(movement.total_cost_khr || 0)

    const createdMs = new Date(movement.created_at || 0).getTime()
    const earliestMs = new Date(existing.created_at || 0).getTime()
    const latestMs = new Date(existing.latest_at || 0).getTime()
    if (!Number.isNaN(createdMs) && (Number.isNaN(earliestMs) || createdMs < earliestMs)) existing.created_at = movement.created_at
    if (!Number.isNaN(createdMs) && (Number.isNaN(latestMs) || createdMs > latestMs)) existing.latest_at = movement.created_at

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
        productCount: uniqueProducts.length,
        productNames: uniqueProducts,
        productSummary: uniqueProducts.length <= 2 ? uniqueProducts.join(', ') : `${uniqueProducts.slice(0, 2).join(', ')} +${uniqueProducts.length - 2}`,
        branchSummary: uniqueBranches.length <= 1 ? (uniqueBranches[0] || '') : `${uniqueBranches[0]} +${uniqueBranches.length - 1}`,
        userSummary: uniqueUsers.length <= 1 ? (uniqueUsers[0] || '') : `${uniqueUsers[0]} +${uniqueUsers.length - 1}`,
        reasonSummary: allReasons[0] || '',
      }
    })
    .sort((a, b) => new Date(b.latest_at || 0).getTime() - new Date(a.latest_at || 0).getTime())
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
