import { readWorkDraft, scopedWorkDraftKey } from './workDrafts.ts'

type SessionDraftShape = {
  branchId?: unknown
  lines?: Array<{ status?: unknown; product?: { id?: unknown } | null } | null>
}

function readSessionDraft(): SessionDraftShape | null {
  try {
    return readWorkDraft<SessionDraftShape>(scopedWorkDraftKey('fast_stockin'))?.data ?? null
  } catch {
    return null
  }
}

/**
 * True while the one Stock Session draft still holds items. The float then
 * reopens that draft and ignores the initialLines / legacyDraft a host hands
 * it, so a host must keep its own copy (a failed attempt, a parked chip)
 * instead of dropping it.
 */
export function stockSessionHasItems(): boolean {
  const lines = readSessionDraft()?.lines
  return Array.isArray(lines) && lines.length > 0
}

/**
 * What a completed session wrote: its branch and the products of its saved
 * lines. Read inside onDone, which the float calls before it clears its
 * draft; null when the draft is gone, so the host reloads everything.
 */
export function stockSessionSavedScope(): { branchId: string; productIds: number[] } | null {
  const draft = readSessionDraft()
  if (!draft || !Array.isArray(draft.lines)) return null
  const productIds = [...new Set(draft.lines.flatMap((line) => {
    const id = Number(line?.product?.id)
    return line?.status === 'saved' && Number.isInteger(id) && id > 0 ? [id] : []
  }))]
  return { branchId: String(draft.branchId ?? ''), productIds }
}
