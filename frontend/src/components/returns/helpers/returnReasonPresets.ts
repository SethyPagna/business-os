export type ReturnReasonScope = 'customer' | 'supplier'

export type ReturnReasonPresets = {
  customer: string[]
  supplier: string[]
}

export type ReturnReasonPresetResponse = {
  configured?: boolean
  presets?: Partial<ReturnReasonPresets> | null
}

export function buildDefaultReturnReasonPresets(t: (key: string) => string | undefined): ReturnReasonPresets {
  const tr = (key: string, fallback: string) => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  return {
    customer: [
      tr('reason_defective', 'Defective / damaged product'),
      tr('reason_wrong_item', 'Wrong item delivered'),
      tr('reason_changed_mind', 'Customer changed mind'),
      tr('reason_not_described', 'Product not as described'),
      tr('reason_duplicate', 'Duplicate order'),
      tr('reason_expired', 'Expired product'),
      tr('reason_quality', 'Quality issue'),
    ],
    supplier: [
      tr('reason_defective_batch', 'Defective batch'),
      tr('reason_expired_stock', 'Expired stock'),
      tr('reason_wrong_shipment', 'Wrong shipment'),
      tr('reason_excess_stock', 'Excess stock'),
    ],
  }
}

export function normalizeReturnReasonList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const output: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const raw = typeof entry === 'object' && entry !== null && 'label' in entry
      ? (entry as { label?: unknown }).label
      : entry
    const label = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 160)
    const key = label.toLocaleLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push(label)
  }
  return output
}

export function resolveReturnReasonPresets(
  response: ReturnReasonPresetResponse | null | undefined,
  fallback: ReturnReasonPresets,
): ReturnReasonPresets {
  if (!response?.configured) {
    return {
      customer: normalizeReturnReasonList(fallback.customer),
      supplier: normalizeReturnReasonList(fallback.supplier),
    }
  }
  return {
    customer: normalizeReturnReasonList(response.presets?.customer),
    supplier: normalizeReturnReasonList(response.presets?.supplier),
  }
}

export function replaceReturnReasonPreset(
  presets: ReturnReasonPresets,
  scope: ReturnReasonScope,
  from: string,
  to: string,
): ReturnReasonPresets {
  const fromKey = String(from || '').trim().toLocaleLowerCase()
  const next = normalizeReturnReasonList(presets[scope].map((reason) => (
    reason.toLocaleLowerCase() === fromKey ? to : reason
  )))
  if (to.trim() && !next.some((reason) => reason.toLocaleLowerCase() === to.trim().toLocaleLowerCase())) next.push(to.trim())
  return { ...presets, [scope]: next }
}

export function removeReturnReasonPreset(
  presets: ReturnReasonPresets,
  scope: ReturnReasonScope,
  value: string,
): ReturnReasonPresets {
  const key = String(value || '').trim().toLocaleLowerCase()
  return { ...presets, [scope]: presets[scope].filter((reason) => reason.toLocaleLowerCase() !== key) }
}
