// S4-21: the ONE close guard. "Close with unsaved changes prompts Discard
// changes or Back. Every modal and float in the app, not a one-off."
//
// Deliberately framework-free so a plain-node test can drive the whole
// sequence (request close -> prompt -> Back -> request close -> Discard)
// and assert what actually happened, instead of pattern-matching JSX.
// utils/useCloseGuard.ts is a thin React wrapper that calls exactly the
// functions below; components never re-implement the decision.
//
// It owns NO dirty state of its own. Dirtiness lives in utils/dirtyWork.ts
// (Part 387), the registry the navigation guard, beforeunload, the sidebar
// dot and the app-update gate already read. A form declares itself dirty
// once, there, and this module asks that registry. Two dirty models in one
// app is the outcome the registry exists to prevent.

import { discardWork, getWorkEntry, isWorkDirty } from './dirtyWork.ts'

/**
 * What a modal says about the work it holds. EVERY modal must say
 * something -- Modal.tsx makes this prop required precisely so a new
 * modal cannot silently opt out by forgetting it.
 *
 * - `'read-only'`     nothing in this modal can be edited and lost.
 * - `{ workKey }`     the key this modal registered in the dirty-work
 *                     registry. PREFERRED for anything form-shaped: the
 *                     same declaration then also drives the navigation
 *                     guard, beforeunload, the sidebar dot and the update
 *                     gate, and Discard runs the entry's own discard hook.
 * - `{ dirty }`       a direct answer, for work that cannot outlive the
 *                     modal (nested pickers, small lookup editors) and so
 *                     has nothing to register page-level.
 */
export type UnsavedChangesDeclaration =
  | 'read-only'
  | { readonly workKey: string }
  | { readonly dirty: boolean }

/**
 * THE OPTION SET -- one line, one place, and the user has ruled on it.
 *
 * The question that was escalated: this prompt says two things (Discard
 * changes / Back); the Part-387 navigation-away guard says three (Save &
 * Leave / Discard & Leave / Stay). One reconciled dialog, or two?
 *
 * THE RULING (Sep 4 2026, the owner, via the coordinator): TWO dialogs,
 * deliberately. THE ASYMMETRY IS THE DECISION -- it is not an
 * inconsistency waiting to be unified, and the three-option
 * navigation-away guard in AppContext/App.tsx is DELIBERATELY UNTOUCHED.
 * Do not "fix" one to match the other. They belong to different moments:
 *
 *   MANUAL  -- the operator means to commit. The explicit Save control at
 *              the END of the modal's content (S4-20). No dialog at all;
 *              they said what they wanted.
 *   AUTOMATIC -- the operator DISMISSED the modal (the ✕), which is a
 *              thing you can hit by accident. That raises THIS prompt:
 *              "Discard changes" / "Back", S4-21's literal wording. It
 *              does not offer Save, because Save is the control sitting
 *              at the end of the page right behind the prompt.
 *   LEAVING THE PAGE -- a different question again ("what about the work
 *              you left behind?"), and it keeps its three options.
 *
 * Every dismissal route must be classified into MANUAL or AUTOMATIC, and
 * the term to use is "dismissal", never "close" -- "close" drifts. Today:
 *   ✕            AUTOMATIC -- routed through applyCloseGuardEvent.
 *   CANCEL       AUTOMATIC -- a Cancel button is a ✕ with a word on it;
 *                same route (shared/Modal children reach it through
 *                ModalCloseContext, hand-rolled ones call requestClose).
 *   BACKDROP     AUTOMATIC, and the easiest one to hit by accident.
 *                shared/Modal.tsx does not close on backdrop; several
 *                hand-rolled overlays DO (ReceiveBatchModal,
 *                FastStockInModal, ... `onClick={closeIfIdle}` on the
 *                `fixed inset-0` div). Where a modal funnels ✕ and
 *                backdrop into one function, guarding that function
 *                covers both.
 *   ESC          not wired in this app today (no keydown handler closes a
 *                modal); if it is ever added it must call requestClose,
 *                never onClose.
 *   MINIMIZE     NEITHER -- it PRESERVES the work (utils/minimizedWork.ts
 *                parks it as a chip), so prompting to discard what the
 *                operator just asked to keep would be backwards. The
 *                minimize control calls its own onMinimize and never the
 *                guarded close.
 *   AFTER SAVE   NEITHER -- the host calls onClose() directly, not
 *                requestClose(). It is not a dismissal; the work is saved.
 *                What keeps this honest is that the save path latches its
 *                dirty state false BEFORE closing, so even a dismissal at
 *                that moment would find nothing to lose.
 *
 * `'save-discard-or-back'` stays implemented so reversing the ruling is
 * one edit to this constant rather than a feature to build.
 */
export type UnsavedCloseOptionSet = 'discard-or-back' | 'save-discard-or-back'
export const UNSAVED_CLOSE_OPTION_SET: UnsavedCloseOptionSet = 'discard-or-back'

export type UnsavedCloseOption = 'save' | 'discard' | 'back'

/**
 * The buttons the prompt shows, in render order. Derived, never hand-listed
 * at a call site -- that is what keeps the ruling a one-line change.
 */
export function unsavedCloseOptions(
  canSave: boolean,
  optionSet: UnsavedCloseOptionSet = UNSAVED_CLOSE_OPTION_SET,
): UnsavedCloseOption[] {
  if (optionSet === 'save-discard-or-back' && canSave) return ['save', 'discard', 'back']
  return ['discard', 'back']
}

/** Is there anything to lose by closing right now? */
export function isDeclarationDirty(declaration: UnsavedChangesDeclaration): boolean {
  if (declaration === 'read-only') return false
  if ('workKey' in declaration) return isWorkDirty(declaration.workKey)
  return declaration.dirty === true
}

/**
 * The registry label for this modal's work ("Product form — Dior 999"), so
 * the prompt names what is at risk instead of asking about "changes" in the
 * abstract. Null for declarations with no registry entry.
 */
export function declaredWorkLabel(declaration: UnsavedChangesDeclaration): string | null {
  if (declaration === 'read-only' || !('workKey' in declaration)) return null
  return getWorkEntry(declaration.workKey)?.label ?? null
}

/** Can this modal's work save itself from the prompt? (Only registry entries can.) */
export function declaredWorkCanSave(declaration: UnsavedChangesDeclaration): boolean {
  if (declaration === 'read-only' || !('workKey' in declaration)) return false
  return typeof getWorkEntry(declaration.workKey)?.save === 'function'
}

export type CloseGuardEvent = 'close-requested' | 'discard-confirmed' | 'back'
export type CloseGuardVerdict = 'closed' | 'prompted' | 'dismissed'

export type CloseGuardParams = {
  event: CloseGuardEvent
  declaration: UnsavedChangesDeclaration
  /** Opens/closes the prompt. React: a useState setter. Test: a variable. */
  setPromptOpen: (open: boolean) => void
  /** The modal's real close. Called ONLY when closing is actually allowed. */
  onClose: () => void
}

/**
 * The whole guard, as one function, used verbatim by the React hook and by
 * the test. Returns what it did so a caller (or an assertion) can tell a
 * close from a prompt without inspecting any UI.
 *
 * Scoping note (nested modals): the declaration belongs to the modal that
 * is closing, so a nested tool -- the barcode camera opened from inside a
 * product form -- consults its OWN declaration ('read-only') and closes
 * straight through. The parent form's dirty work is registered under a
 * different key and is never consulted by the child's ✕.
 */
export function applyCloseGuardEvent({ event, declaration, setPromptOpen, onClose }: CloseGuardParams): CloseGuardVerdict {
  if (event === 'back') {
    setPromptOpen(false)
    return 'dismissed'
  }
  if (event === 'discard-confirmed') {
    if (declaration !== 'read-only' && 'workKey' in declaration) discardWork(declaration.workKey)
    setPromptOpen(false)
    onClose()
    return 'closed'
  }
  if (isDeclarationDirty(declaration)) {
    setPromptOpen(true)
    return 'prompted'
  }
  setPromptOpen(false)
  onClose()
  return 'closed'
}

/**
 * The Save arm, live now so switching UNSAVED_CLOSE_OPTION_SET stays a
 * one-line change rather than a feature to build later. A refused save
 * (validation, throw) keeps the prompt open -- no silent close, no
 * optimistic "saved" -- which is the same reading resolveNavGuard('save')
 * already takes in AppContext.
 */
export async function applySaveAndClose({ declaration, setPromptOpen, onClose }: Omit<CloseGuardParams, 'event'>): Promise<CloseGuardVerdict> {
  const entry = declaration !== 'read-only' && 'workKey' in declaration ? getWorkEntry(declaration.workKey) : undefined
  if (!entry?.save) return 'prompted'
  try {
    const saved = await entry.save()
    if (!saved) return 'prompted'
  } catch {
    return 'prompted'
  }
  setPromptOpen(false)
  onClose()
  return 'closed'
}
