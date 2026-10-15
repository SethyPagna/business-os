import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

// Stacked dialogs answer the keyboard one at a time: only the newest one reacts.
type DialogEntry = { panel: HTMLElement | null; previousFocus: HTMLElement | null; parent: DialogEntry | null }
const openDialogs: DialogEntry[] = []

function available(element: HTMLElement | null): element is HTMLElement {
  return !!element && element.isConnected && element.getClientRects().length > 0
    && element.getAttribute('disabled') === null && !element.closest('[hidden], [inert], [aria-hidden="true"]')
}

function preferredFocus(panel: HTMLElement | null): HTMLElement | null {
  const content = panel?.querySelector<HTMLElement>('[role="region"][tabindex="0"]')
  const named = content && (content.getAttribute('aria-label')?.trim() || content.getAttribute('aria-labelledby')?.trim())
  return named && available(content) ? content : panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel
}

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
    const entry: DialogEntry = { panel: panelRef.current, previousFocus: document.activeElement as HTMLElement | null, parent: openDialogs[openDialogs.length - 1] ?? null }
    openDialogs.push(entry)
    preferredFocus(panelRef.current)?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== entry) return
      // A dialog that opened a confirm or picker of its own (ProductForm's save review, file picker, scanner) is made
      // inert while that surface is up. The surface on top owns the keyboard; this one answering Escape would close
      // the form underneath it and lose the work the confirm was about to save.
      if (panelRef.current?.closest('[inert]')) return
      if (!['Escape', 'Tab', 'PageUp', 'PageDown'].includes(event.key)) return
      const { promptOpen: promptShowing, onEscape: close, onPromptEscape: dismissPrompt } = latest.current
      const hints = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[aria-expanded="true"][aria-controls]') || []).flatMap(trigger => {
        const popup = document.getElementById(trigger.getAttribute('aria-controls') || '')
        return popup?.getAttribute('role') === 'tooltip' && !popup.hidden && popup.getClientRects().length > 0 ? [{ trigger, popup }] : []
      })
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        const panel = panelRef.current
        const target = event.target as HTMLElement | null
        if (promptShowing || hints.length || document.querySelector('[data-app-select-menu="true"]') || !panel || !target || !panel.contains(target)) return
        if (target.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="tooltip"]')) return
        const content = panel.querySelector<HTMLElement>('[role="region"][tabindex="0"]')
        const named = content && (content.getAttribute('aria-label')?.trim() || content.getAttribute('aria-labelledby')?.trim())
        const scroll = content?.closest<HTMLElement>('.modal-scroll')
        if (!named || !available(content) || content.contains(target) || !scroll || !panel.contains(scroll)) return
        event.preventDefault()
        scroll.scrollBy({ top: scroll.clientHeight * (event.key === 'PageDown' ? 1 : -1) })
        return
      }
      if (event.key === 'Escape') {
        if (document.querySelector('[data-app-select-menu="true"]') || (!promptShowing && hints.length)) return
        event.preventDefault()
        if (promptShowing) dismissPrompt()
        else close()
        return
      }
      if (event.key !== 'Tab' || promptShowing) return
      const activeHint = hints.find(({ popup }) => popup.contains(document.activeElement))
      if (activeHint) { event.preventDefault(); activeHint.trigger.focus(); return }
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])
      if (!focusable.length) { event.preventDefault(); panelRef.current?.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (document.activeElement === panelRef.current) { event.preventDefault(); (event.shiftKey ? last : first).focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const wasTopmost = openDialogs[openDialogs.length - 1] === entry
      const at = openDialogs.indexOf(entry)
      if (at >= 0) openDialogs.splice(at, 1)
      const active = document.activeElement
      if (!wasTopmost || (active && active !== document.body && active.isConnected && !entry.panel?.contains(active))) return
      let origin: DialogEntry | null = entry
      while (origin) {
        if (origin.previousFocus !== document.body && origin.previousFocus !== document.documentElement && available(origin.previousFocus)) { origin.previousFocus.focus(); return }
        const parent = origin.parent?.panel
        if (parent?.isConnected) {
          if (!available(parent)) return
          const target = preferredFocus(parent)
          if (available(target)) target.focus()
          return
        }
        origin = origin.parent
      }
    }
  }, [enabled, panelRef])
}
