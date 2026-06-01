export const PENDING_SYNC_PREVIEW_LIMIT = 25

export interface PendingSyncPreviewInput {
  _seq?: unknown
  channel?: unknown
  operation?: unknown
  entity_table?: unknown
  entity_id?: unknown
  entity_name?: unknown
  status?: unknown
  created_at?: unknown
  updated_at?: unknown
  retry_count?: unknown
  retry_at?: unknown
  error?: unknown
}

export interface PendingSyncPreviewItem {
  _seq: unknown
  channel: unknown
  operation: unknown | null
  entity_table: unknown | null
  entity_id: unknown | null
  entity_name: unknown | null
  status: string
  created_at: unknown | null
  updated_at: unknown | null
  retry_count: number
  retry_at: unknown | null
  error: unknown | null
}

export function serializePendingSyncPreview(items: PendingSyncPreviewInput[] = []): PendingSyncPreviewItem[] {
  const preview: PendingSyncPreviewItem[] = []
  const limit = Math.min(PENDING_SYNC_PREVIEW_LIMIT, items.length)
  for (let index = 0; index < limit; index += 1) {
    const item = items[index]
    preview.push({
      _seq: item._seq,
      channel: item.channel,
      operation: item.operation || null,
      entity_table: item.entity_table || null,
      entity_id: item.entity_id ?? null,
      entity_name: item.entity_name || null,
      status: String(item.status || 'pending'),
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
      retry_count: Number(item.retry_count || 0),
      retry_at: item.retry_at || null,
      error: item.error || null,
    })
  }
  return preview
}
