export function isProductCreateReviewState(id: number, value: unknown, status: 'approved' | 'rejected'): boolean {
  if (!Number.isSafeInteger(id) || id <= 0 || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return row.id === id && row.status === status && row.section === 'products' && row.action_type === 'create' && row.entity_type === 'product'
}

export function isConfirmedProductCreateApproval(id: number, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return response.success === true && (response.pending === undefined || response.pending === false)
    && isProductCreateReviewState(id, response.data, 'approved')
}
