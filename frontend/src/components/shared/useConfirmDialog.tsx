import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import ConfirmDialog, { type ConfirmDialogLayer, type ConfirmReviewItem } from './ConfirmDialog'

// The awaitable form of the shared ConfirmDialog -- the drop-in replacement
// for `if (!window.confirm(text)) return` (FX-ui, 27 Sep 2026). The owner
// rule is one compact, translated review dialog for every mutating action and
// never the browser's native confirm(); the native popup is off-brand, cannot
// be translated by the app and cannot show a before/after review.
//
//   const { askToConfirm, confirmDialog } = useConfirmDialog(t)
//   if (!(await askToConfirm({ title, message, items, danger: true }))) return
//   ...
//   return <>{...}{confirmDialog}</>
//
// askToConfirm() resolves true on Confirm and false on Cancel, the X, Escape or an
// unmount -- the same two outcomes native confirm() had, so a call site keeps
// its behaviour: the action on true, nothing on false. Asking again while a
// question is open answers the earlier one false first, so no caller is ever
// left awaiting a promise that can no longer settle.
//
// The dialog opens on the nested layer unless the request says otherwise: a
// question the operator must answer before anything else happens belongs
// above whatever surface asked it, and half of these callers are modals
// (shared Modal portals to <body>, default z-1050; nested is z-1070, still
// under the toast layer).

type Translate = (key: string, fallback?: string) => string | undefined

export type ConfirmRequest = {
  title: ReactNode
  message?: ReactNode
  items?: ConfirmReviewItem[]
  note?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  danger?: boolean
  layer?: ConfirmDialogLayer
}

type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void }

export function useConfirmDialog(t?: Translate) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(confirmed)
  }, [])

  const askToConfirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false)
    const next = { ...request, resolve }
    pendingRef.current = next
    setPending(next)
  }), [])

  useEffect(() => () => {
    pendingRef.current?.resolve(false)
    pendingRef.current = null
  }, [])

  const confirmDialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      items={pending.items}
      note={pending.note}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      danger={pending.danger}
      layer={pending.layer ?? 'nested'}
      t={t}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  ) : null

  return { askToConfirm, confirmDialog }
}
