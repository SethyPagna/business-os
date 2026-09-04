import { useCallback, useRef, useState } from 'react'
import {
  applyCloseGuardEvent,
  applySaveAndClose,
  declaredWorkCanSave,
  declaredWorkLabel,
  isDeclarationDirty,
  unsavedCloseOptions,
  type UnsavedChangesDeclaration,
  type UnsavedCloseOption,
} from './closeGuard.ts'

// S4-21: the React side of the close guard -- deliberately thin. Every
// decision is made by utils/closeGuard.ts, which a node test drives
// directly; this file only holds the prompt's open/closed bit and hands
// the same functions React's event handlers.
//
// Two entry points exist on purpose:
//  - components/shared/Modal.tsx calls this for its own ✕, so every modal
//    built on the shared chrome is guarded by declaring one prop; and
//  - a hand-rolled overlay (its own `fixed inset-0`, its own ✕) calls this
//    directly and renders <UnsavedChangesPrompt>, so it gets identical
//    behaviour without first being rewritten onto the shared Modal.
//
// Latest-value refs, not dependency arrays: a declaration is usually a
// fresh object literal each render ({ workKey: ... }), so memoising on it
// would rebuild every handler anyway and a stale closure would ask about
// the previous render's dirtiness.

export type CloseGuard = {
  /** Wire this to the ✕, to Cancel, and to any other "close" affordance. */
  requestClose: () => void
  /** Is the discard prompt showing? */
  promptOpen: boolean
  /** Prompt buttons, in order -- derived from the one option-set constant. */
  options: UnsavedCloseOption[]
  /** "Back" -- returns to the modal with every edit intact. */
  dismissPrompt: () => void
  /** "Discard changes" -- runs the registry's discard hook, then closes. */
  discardAndClose: () => void
  /** "Save" -- only rendered when the option set includes it. */
  saveAndClose: () => void
  /** True while an in-prompt save is running. */
  saving: boolean
  /** The registry's label for the work at risk, when there is one. */
  workLabel: string | null
}

export function useCloseGuard(declaration: UnsavedChangesDeclaration, onClose: () => void): CloseGuard {
  const [promptOpen, setPromptOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const latest = useRef({ declaration, onClose })
  latest.current = { declaration, onClose }

  const requestClose = useCallback(() => {
    applyCloseGuardEvent({ event: 'close-requested', declaration: latest.current.declaration, setPromptOpen, onClose: () => latest.current.onClose() })
  }, [])

  const dismissPrompt = useCallback(() => {
    applyCloseGuardEvent({ event: 'back', declaration: latest.current.declaration, setPromptOpen, onClose: () => latest.current.onClose() })
  }, [])

  const discardAndClose = useCallback(() => {
    applyCloseGuardEvent({ event: 'discard-confirmed', declaration: latest.current.declaration, setPromptOpen, onClose: () => latest.current.onClose() })
  }, [])

  const saveAndClose = useCallback(() => {
    setSaving(true)
    void applySaveAndClose({ declaration: latest.current.declaration, setPromptOpen, onClose: () => latest.current.onClose() })
      .finally(() => setSaving(false))
  }, [])

  return {
    requestClose,
    promptOpen,
    options: unsavedCloseOptions(declaredWorkCanSave(declaration)),
    dismissPrompt,
    discardAndClose,
    saveAndClose,
    saving,
    workLabel: promptOpen || isDeclarationDirty(declaration) ? declaredWorkLabel(declaration) : null,
  }
}
