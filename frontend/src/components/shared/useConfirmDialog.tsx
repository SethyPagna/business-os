import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import ConfirmDialog, { type ConfirmDialogLayer, type ConfirmReviewItem } from './ConfirmDialog.tsx'

// U-confirm: the promise-shaped front door to the shared ConfirmDialog, so a
// call site that used to read
//
//   if (!window.confirm(message)) return
//
// reads
//
//   if (!(await askConfirm({ message }))) return
//
// and renders `{confirmDialog}` once. Same contract as the native dialog it
// replaces: resolves true only on Confirm; Cancel, the X, Escape, a second
// request arriving while one is open, and the host unmounting all resolve
// false, so a cancelled action has no side effect. Enter confirms (the
// Confirm button takes focus on open). The owner's rule is ONE compact review
// dialog for every mutating action -- never native confirm(), which is
// off-brand, untranslatable and cannot show the values under review.
//
// Named askConfirm, never `confirm`: tests/noNativeConfirm.test.ts treats a
// file that declares its own `confirm` as exempt, so the name would hide a
// real native call left elsewhere in the same file.

const useApp = useAppHook as unknown as () => { t?: (key: string) => string }

export type ConfirmRequest = {
  /** Defaults to the translated "Confirm". */
  title?: ReactNode
  /** The question itself -- the exact sentence the native dialog showed. */
  message: ReactNode
  /** Review rows: the record and the values before/after the change. */
  items?: ConfirmReviewItem[]
  note?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  /** Red banner + red button, for destructive actions. */
  danger?: boolean
  /** Defaults to 'nested' so a dialog asked from inside a modal stacks above it. */
  layer?: ConfirmDialogLayer
}

export type AskConfirm = (request: ConfirmRequest) => Promise<boolean>

export function useConfirmDialog(): { askConfirm: AskConfirm; confirmDialog: ReactNode } {
  const { t } = useApp()
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const settle = useCallback((ok: boolean) => {
    const resolve = resolveRef.current
    resolveRef.current = null
    setRequest(null)
    resolve?.(ok)
  }, [])

  const askConfirm = useCallback<AskConfirm>((next) => new Promise<boolean>((resolve) => {
    // A newer question supersedes an unanswered one; the older caller sees
    // "no", never a hung promise.
    resolveRef.current?.(false)
    resolveRef.current = resolve
    setRequest(next)
  }), [])

  useEffect(() => () => {
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  const tr = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const confirmDialog = request ? (
    <ConfirmDialog
      title={request.title ?? tr('confirm', 'Confirm')}
      message={request.message}
      items={request.items}
      note={request.note}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      danger={request.danger}
      layer={request.layer ?? 'nested'}
      keyboard
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
      t={t}
    />
  ) : null

  return { askConfirm, confirmDialog }
}
