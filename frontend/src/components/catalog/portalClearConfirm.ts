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

type ContainerLike = { contains: (node: never) => boolean }

/**
 * Focus left the question for another element on the page (Tab, or a click that focuses something else). A blur with no next element is
 * NOT a leave: Safari and Firefox on a Mac do not focus a button that is pressed, so pressing Clear itself blurs Keep with no target, and
 * treating that as "left" put the question away before Clear got its click.
 */
export function clearAllFocusLeft(root: ContainerLike | null, next: unknown): boolean {
  if (!root || next === null || next === undefined) return false
  return !root.contains(next as never)
}

/** A press outside the question puts it away; a press on Clear or Keep is theirs to handle. */
export function clearAllPressIsOutside(root: ContainerLike | null, target: unknown): boolean {
  if (!root) return false
  if (target === null || target === undefined) return true
  return !root.contains(target as never)
}
