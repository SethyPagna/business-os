export type ClearAllEvent = 'ask' | 'confirm' | 'keep' | 'escape' | 'leave'

/**
 * The List page's "Clear all" in two steps. One tap only asks; the list is emptied by `confirm`, and `confirm` does nothing unless the ask came
 * first. Keep, Escape and moving away (focus leaving the control, or the other segment opening) all return to the resting state.
 */
export function clearAllStep(confirming: boolean, event: ClearAllEvent): { confirming: boolean; clear: boolean } {
  if (event === 'ask') return { confirming: true, clear: false }
  if (event === 'confirm') return { confirming: false, clear: confirming }
  return { confirming: false, clear: false }
}
