import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

// Stacked dialogs answer the keyboard one at a time: only the newest one reacts.
const openDialogs: symbol[] = []

/**
 * The keyboard contract of a modal dialog: focus moves in on open and returns
 * to where it was on close, Tab stays inside the panel, and Escape closes it
 * through the same guard as the X -- unless a portalled listbox (AppSelect) is
 * open, which owns that first Escape.
 *
 * Opt-in through <Modal keyboard>; one implementation instead of a copy inside
 * every dialog that needed it.
 */
export function useDialogKeyboard(
  panelRef: RefObject<HTMLElement | null>,
  { enabled, promptOpen, onEscape, onPromptEscape }: { enabled: boolean; promptOpen: boolean; onEscape: () => void; onPromptEscape: () => void },
): void {
  const latest = useRef({ promptOpen, onEscape, onPromptEscape })
  latest.current = { promptOpen, onEscape, onPromptEscape }

  useEffect(() => {
    if (!enabled) return undefined
    const id = Symbol('dialog')
    openDialogs.push(id)
    const previousFocus = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== id) return
      const { promptOpen: promptShowing, onEscape: close, onPromptEscape: dismissPrompt } = latest.current
      if (event.key === 'Escape') {
        if (document.querySelector('[data-app-select-menu="true"]')) return
        event.preventDefault()
        if (promptShowing) dismissPrompt()
        else close()
        return
      }
      if (event.key !== 'Tab' || promptShowing) return
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const at = openDialogs.indexOf(id)
      if (at >= 0) openDialogs.splice(at, 1)
      previousFocus?.focus()
    }
  }, [enabled, panelRef])

  useEffect(() => {
    if (!enabled || !promptOpen) return
    // The discard prompt is its own dialog above this one: put the keyboard on it.
    window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
      dialogs[dialogs.length - 1]?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    })
  }, [enabled, promptOpen])
}
