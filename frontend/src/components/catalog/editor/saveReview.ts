// The Website Editor's save model, as two pure rules (EDITOR-REDESIGN-REFRESH, ED-1a):
//   1. what the "Save these changes?" review lists, and
//   2. which of the bar's five Save states shows.
// Neither writes anything: the write is CatalogPage's savePortalDraft, which the review sits outside of, so the leave
// guard's "Save & Leave" still reaches it with no review.
import { EDITOR_SECTIONS, sectionIdForKey, type EditorSectionId } from './editorSections.ts'

export type SaveReviewRow = { id: EditorSectionId; count: number }

/** One row per section the person can see that holds a changed key, in section order; count is the number of changed keys. */
export function saveReviewRows(editedKeys: ReadonlySet<string>, visibleIds: readonly EditorSectionId[]): SaveReviewRow[] {
  const counts = new Map<EditorSectionId, number>()
  for (const key of editedKeys) {
    const id = sectionIdForKey(key)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return EDITOR_SECTIONS
    .filter((section) => visibleIds.includes(section.id) && counts.has(section.id))
    .map((section) => ({ id: section.id, count: counts.get(section.id) ?? 0 }))
}

/** Why Save cannot run: an upload still in flight, or the settings read the draft is built on has not landed. */
export type SaveBlockedReason = 'uploads' | 'loading'
export type SaveBarState = 'idle' | 'changed' | 'blocked' | 'saving' | 'saved'

/**
 * Saving first (a Save in flight is Saving whatever else is true), then Blocked (an upload in flight blocks even before
 * the upload lands as an edit), then the 2 s Saved flash -- which a newer edit ends at once, so a change typed just after a
 * Save is Changed, not a Save that cannot be pressed -- then Changed, else Idle.
 */
export function saveBarState(input: { dirty: boolean; saving: boolean; blockedReason: SaveBlockedReason | null; savedFlash: boolean }): SaveBarState {
  if (input.saving) return 'saving'
  if (input.blockedReason) return 'blocked'
  if (input.dirty) return 'changed'
  return input.savedFlash ? 'saved' : 'idle'
}
