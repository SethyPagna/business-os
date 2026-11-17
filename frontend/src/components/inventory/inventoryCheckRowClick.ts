// The click rule of an Inventory row: Products' own (Products.tsx: deferCopySurfaceAction plus a controls guard), shared by the list rows and the in-session rows so the two never differ.
import type { MouseEvent } from 'react'
import { COPY_SELECTOR, deferCopySurfaceAction } from '../shared/textAffordances.ts'

/** What a click inside a row leaves alone: the status button, the count input and the note, links, and any other control. Everything else on the row opens the detail. */
export const ROW_CONTROL_SELECTORS = ['button', 'a[href]', 'input', 'select', 'textarea', 'label', 'summary', '[role="button"]'] as const

/**
 * A press on a copy target waits out the double-click window, so a double-click copies instead of opening; a press on a control belongs to the control; any other press opens the detail.
 * Only presses INSIDE the row count: the count popover and every other portal bubble their clicks through React, not through the DOM.
 */
export function rowClickOpens(event: Pick<MouseEvent<HTMLElement>, 'target' | 'currentTarget' | 'defaultPrevented'>, open: () => void): void {
  const target = event.target as Element | null
  if (event.defaultPrevented || !target || typeof target.closest !== 'function' || !event.currentTarget.contains(target)) return
  const copyTarget = target.closest(COPY_SELECTOR)
  if (copyTarget && event.currentTarget.contains(copyTarget)) { deferCopySurfaceAction(copyTarget, open); return }
  if (ROW_CONTROL_SELECTORS.some(selector => target.closest(selector))) return
  open()
}
