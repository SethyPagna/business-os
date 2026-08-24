export type SettingsUpdatePayload = Record<string, unknown>

export interface ReturnItemConflictPreview {
  product_name: unknown
  quantity: unknown
  return_to_stock: boolean
}

export interface ReturnItemLike {
  product_name?: unknown
  quantity?: unknown
  return_to_stock?: unknown
}

export const SETTINGS_CONFLICT_META_KEYS = new Set([
  'expectedUpdatedAt',
  'expected_updated_at',
  'updated_at',
  'updatedAt',
])

export function buildAttemptedSettings(updates: SettingsUpdatePayload | null | undefined = {}): SettingsUpdatePayload {
  const attempted: SettingsUpdatePayload = {}
  for (const key of Object.keys(updates || {})) {
    if (SETTINGS_CONFLICT_META_KEYS.has(key)) continue
    attempted[key] = updates?.[key]
  }
  return attempted
}

export function buildAttemptedReturnItems(items: unknown[] = []): ReturnItemConflictPreview[] {
  const attemptedItems: ReturnItemConflictPreview[] = []
  for (const item of Array.isArray(items) ? items : []) {
    const row = (item || {}) as ReturnItemLike
    attemptedItems.push({
      product_name: row.product_name || '',
      quantity: row.quantity || 0,
      return_to_stock: row.return_to_stock !== false,
    })
  }
  return attemptedItems
}
