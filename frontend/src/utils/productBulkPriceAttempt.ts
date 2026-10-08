import { ensureClientRequestId } from '../api/requestIds.ts'
import { clearUnchangedWorkDraft, readWorkDraft, scopedWorkDraftKey, writeWorkDraft, type WorkDraft } from './workDrafts.ts'

export type CatalogPriceIntent = { direction: 'increase' | 'decrease'; amount: number; fields: string[]; skip_zero: boolean }
export type CatalogPriceAttempt = { payload: CatalogPriceIntent & { client_request_id: string }; count: number }
const prefix = () => scopedWorkDraftKey('catalog_price_adjust') + ':'
const key = (intent: CatalogPriceIntent) => prefix() + encodeURIComponent(JSON.stringify(intent))
const unsaved = () => Object.assign(new Error('The price request could not be saved on this device. No adjustment was sent. Check available storage and try again.'), { code: 'bulk_price_request_not_saved' })

function valid(data: CatalogPriceAttempt): boolean {
  const p = data?.payload
  return !!p && ['increase', 'decrease'].includes(p.direction) && Number.isFinite(p.amount) && p.amount > 0
    && Array.isArray(p.fields) && p.fields.length > 0 && p.fields.every(f => /^(selling|wholesale|cost)_price_(usd|khr)$/.test(f))
    && typeof p.skip_zero === 'boolean' && /^[A-Za-z0-9_-]{8,120}$/.test(p.client_request_id)
    && Number.isSafeInteger(data.count) && data.count >= 0
}
const intentOf = (p: CatalogPriceAttempt['payload']): CatalogPriceIntent => ({ direction: p.direction, amount: p.amount, fields: p.fields, skip_zero: p.skip_zero })
function readSaved(draftKey: string): WorkDraft<CatalogPriceAttempt> | null {
  try {
    const raw = localStorage.getItem(draftKey)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as WorkDraft<CatalogPriceAttempt>
    if (!Number.isFinite(parsed.at) || !valid(parsed.data)) throw unsaved()
    return readWorkDraft<CatalogPriceAttempt>(draftKey)
  } catch { throw unsaved() }
}

export function readCatalogPriceAttempt(intent: CatalogPriceIntent): CatalogPriceAttempt | null {
  const saved = readSaved(key(intent))
  if (!saved) return null
  if (!valid(saved.data) || JSON.stringify(intentOf(saved.data.payload)) !== JSON.stringify(intent)) throw unsaved()
  return saved.data
}

export function prepareCatalogPriceAttempt(intent: CatalogPriceIntent, count: number): { attempt: CatalogPriceAttempt; saved: WorkDraft<CatalogPriceAttempt> } {
  const draftKey = key(intent)
  let saved = readSaved(draftKey)
  if (!saved) {
    writeWorkDraft(draftKey, { payload: ensureClientRequestId(intent, 'price_adjust'), count })
    saved = readSaved(draftKey)
  }
  if (!saved || !valid(saved.data) || JSON.stringify(intentOf(saved.data.payload)) !== JSON.stringify(intent)) throw unsaved()
  return { attempt: saved.data, saved }
}

export function settleCatalogPriceAttempt(attempt: CatalogPriceAttempt, saved: WorkDraft<CatalogPriceAttempt>): boolean {
  return clearUnchangedWorkDraft(key(intentOf(attempt.payload)), saved)
}

export function listCatalogPriceAttempts(): CatalogPriceAttempt[] {
  const result: CatalogPriceAttempt[] = []
  try {
    const ownedPrefix = prefix()
    for (let i = 0; i < localStorage.length; i++) {
      const draftKey = localStorage.key(i)
      if (!draftKey?.startsWith(ownedPrefix)) continue
      const saved = readSaved(draftKey)
      if (saved && valid(saved.data) && key(intentOf(saved.data.payload)) === draftKey) result.push(saved.data)
    }
  } catch {}
  return result
}
