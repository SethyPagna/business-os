import type { InventoryCheckSubmission } from '../../api/inventoryChecksTransport.ts'
import type { ListDraft } from './InventoryCheckListRows.tsx'

/** A typed count as the page holds it, plus the `check_at` the row showed when it last changed (judged on restore, never against the device clock). */
export type CountDraftEntry = ListDraft & { name: string; seen: number | null; checkAt?: string | null }
export type PendingSubmission = { requestId: string; lines: InventoryCheckSubmission['lines']; left: number; taskId?: string }
export type StoredCountDraft = { v: 1; entries: Record<string, CountDraftEntry & { checkAt: string | null }>; pending?: PendingSubmission }

/** One key per branch and task (or the plain list); the device store adds origin, server, organization and user. */
export const countDraftBaseKey = (branchId: string, taskId: string): string => `inventory-check-counts_${branchId}_${taskId || 'list'}`

/** What to write for the page's drafts, or null when there is nothing to keep (the caller clears the key). */
export function serializeCountDraft(drafts: Readonly<Record<string, CountDraftEntry>>, pending: PendingSubmission | null): StoredCountDraft | null {
  const entries: StoredCountDraft['entries'] = {}
  for (const [id, entry] of Object.entries(drafts)) entries[id] = { ...entry, checkAt: entry.checkAt ?? null }
  if (!Object.keys(entries).length && !pending) return null
  return { v: 1, entries, ...(pending ? { pending } : {}) }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** The stored record as drafts, dropping anything that is not the shape this page wrote (a hand-edited or older record never reaches the list). */
export function parseCountDraft(raw: unknown): StoredCountDraft | null {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.entries)) return null
  const entries: StoredCountDraft['entries'] = {}
  for (const [id, value] of Object.entries(raw.entries)) {
    if (!/^\d+$/.test(id) || !isRecord(value)) continue
    if (typeof value.count !== 'string' || typeof value.note !== 'string' || typeof value.name !== 'string' || typeof value.selected !== 'boolean' || typeof value.checked !== 'boolean') continue
    if (value.seen !== null && !(typeof value.seen === 'number' && Number.isFinite(value.seen))) continue
    entries[id] = { ...value, checkAt: typeof value.checkAt === 'string' ? value.checkAt : null } as StoredCountDraft['entries'][string]
  }
  const pending = isRecord(raw.pending) && typeof raw.pending.requestId === 'string' && Array.isArray(raw.pending.lines) && typeof raw.pending.left === 'number'
    ? raw.pending as unknown as PendingSubmission : undefined
  return { v: 1, entries, ...(pending ? { pending } : {}) }
}

/**
 * Which restored entries still stand. A product counted (anywhere) after the entry was typed shows a different `check_at` now: its draft is dropped. A product with no
 * count at all, or the same one, keeps its draft. `latest` holds the server's `check_at` per product the screen or the overlay knows; a product it does not name has none.
 */
export function judgeRestored(entries: StoredCountDraft['entries'], latest: ReadonlyMap<number, string | null | undefined>): { kept: Record<string, CountDraftEntry>; dropped: string[] } {
  const kept: Record<string, CountDraftEntry> = {}
  const dropped: string[] = []
  for (const [id, entry] of Object.entries(entries)) {
    const now = latest.get(Number(id)) ?? null
    if (now !== null && now !== entry.checkAt) dropped.push(id)
    else kept[id] = entry
  }
  return { kept, dropped }
}
