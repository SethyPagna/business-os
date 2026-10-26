import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
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
// askToConfirm() resolves true on Confirm (or Enter: Confirm takes focus on
// open) and false on Cancel, the X, Escape or an unmount -- the same two
// outcomes native confirm() had, so a call site keeps its behaviour: the
// action on true, nothing on false. A `danger` ask focuses Cancel instead,
// so Enter cannot confirm a delete. Asking again while a
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

// attempt: a password ask runs the action itself while the dialog stays open. It answers null when the action
// went through (or failed for a reason the caller handles outside the dialog) and the sentence to show inline
// when the password was refused, so staff can retype it.
type PasswordAttempt = (password: string) => Promise<string | null>
type PendingConfirm = ConfirmRequest & { resolve: (confirmed: boolean) => void; attempt?: PasswordAttempt }

// Every outcome but Confirm answers false.
function cancelPending(pending: PendingConfirm | null) {
  pending?.resolve(false)
}

export function useConfirmDialog(t?: Translate) {
  // A host that passes no t still gets Cancel/Confirm in the operator's language.
  const appT = (useAppHook() as { t?: Translate }).t
  const translate = t ?? appT
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  const [password, setPassword] = useState('')
  const passwordRef = useRef('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordWorking, setPasswordWorking] = useState(false)
  const passwordInputRef = useRef<HTMLInputElement | null>(null)

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    passwordRef.current = ''
    setPending(null)
    setPassword('')
    setPasswordError('')
    setPasswordWorking(false)
    current?.resolve(confirmed)
  }, [])

  const askToConfirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => {
    cancelPending(pendingRef.current)
    passwordRef.current = ''
    setPassword('')
    setPasswordError('')
    const next = { ...request, resolve }
    pendingRef.current = next
    setPending(next)
  }), [])

  // The same dialog with a current-password field (the step-up the Worker asks
  // for before a destructive write). Confirm stays disabled until one is typed,
  // then runs `attempt` with the dialog still open. A refusal comes back as a
  // sentence shown inline; the field is cleared and refocused for a retry, and
  // Cancel/X/Escape stay available (a way out). Resolves true once the attempt
  // answers null, false on every dismissal.
  const askForPassword = useCallback((request: ConfirmRequest, attempt: PasswordAttempt) => new Promise<boolean>((resolve) => {
    cancelPending(pendingRef.current)
    passwordRef.current = ''
    setPassword('')
    setPasswordError('')
    setPasswordWorking(false)
    const next = { ...request, resolve, attempt }
    pendingRef.current = next
    setPending(next)
  }), [])

  useEffect(() => () => {
    cancelPending(pendingRef.current)
    pendingRef.current = null
  }, [])

  // Escape answers no. Here, not in ConfirmDialog: the dialog sits in
  // app-shared, which the public catalog loads; this hook is admin-only.
  const open = pending !== null
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      settle(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, settle])

  const submitPassword = async () => {
    const current = pendingRef.current
    const typed = passwordRef.current
    if (!current?.attempt || !typed || passwordWorking) return
    setPasswordWorking(true)
    setPasswordError('')
    let refusal: string | null = null
    try { refusal = await current.attempt(typed) } catch (error) { refusal = error instanceof Error && error.message ? error.message : 'Failed' }
    if (pendingRef.current !== current) return
    if (refusal === null) { settle(true); return }
    passwordRef.current = ''
    setPassword('')
    setPasswordError(refusal)
    setPasswordWorking(false)
    setTimeout(() => passwordInputRef.current?.focus(), 0)
  }

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
      keyboard={!pending.attempt}
      confirmDisabled={pending.attempt ? !password : false}
      working={pending.attempt ? passwordWorking : false}
      t={translate}
      onConfirm={() => { if (pending.attempt) void submitPassword(); else settle(true) }}
      onClose={() => settle(false)}
    >
      {pending.attempt ? (
        <div>
          <label htmlFor="confirm-dialog-current-password" className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
            {translate?.('current_password') || 'Current password'}
          </label>
          <input
            id="confirm-dialog-current-password"
            name="current_password"
            type="password"
            autoComplete="current-password"
            autoFocus
            ref={passwordInputRef}
            disabled={passwordWorking}
            aria-invalid={passwordError ? true : undefined}
            className="input w-full"
            value={password}
            onChange={(event) => { passwordRef.current = event.target.value; setPassword(event.target.value) }}
            onKeyDown={(event) => { if (event.key === 'Enter' && passwordRef.current) { event.preventDefault(); void submitPassword() } }}
          />
          {passwordError ? <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{passwordError}</p> : null}
        </div>
      ) : null}
    </ConfirmDialog>
  ) : null

  return { askToConfirm, askForPassword, confirmDialog }
}
