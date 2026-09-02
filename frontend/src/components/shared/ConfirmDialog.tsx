import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import type { ReactNode } from 'react'
import Modal from './Modal'

// Shared compact "review before you commit" confirmation dialog (Part 563).
// The single, on-brand answer to the user's "confirm / double-check" ask: one
// small modal that SUMMARIZES what is about to happen (a short list of
// label/value review rows) and gates the action behind an explicit
// Confirm/Cancel. It replaces the app's scattered, inconsistent confirmation
// surfaces -- ~23 native window.confirm() popups (off-brand, untranslatable) --
// with a consistent, translated dialog that matches DeleteConfirmModal (which
// stays the reference for destructive flows) and the shared Modal chrome.
//
// Deliberately presentational and prop-driven so every mutating action across
// the app can reuse it: callers pass a title, an optional lead `message` (e.g.
// the record's name), the `items` review rows, and Confirm/Cancel handlers.
// `danger` gives destructive actions the red banner + red button treatment.
// The promise-based "await a choice mid-save" wiring lives at each call site
// (mirroring ProductForm's existing askRenameChoice/askCreateVerdict pattern),
// not here -- this component only renders and reports the click.

type Translate = (key: string, fallback?: string) => string | undefined

export type ConfirmReviewItem = {
  label: ReactNode
  value: ReactNode
}

type ConfirmDialogProps = {
  title: ReactNode
  /** One-line lead describing the action (often the record's name, bolded). */
  message?: ReactNode
  /** The compact "what's about to happen" review -- label/value rows. */
  items?: ConfirmReviewItem[]
  /** Rare extra body content for callers that need more than items. */
  children?: ReactNode
  /** Optional footnote (e.g. "You can undo this immediately after"). */
  note?: ReactNode
  confirmLabel?: ReactNode
  cancelLabel?: ReactNode
  /** Red banner + red confirm button, for destructive actions. */
  danger?: boolean
  /** Disables both buttons and shows the working label while the action runs. */
  working?: boolean
  workingLabel?: ReactNode
  /** Independently disables Confirm (e.g. a required reason not yet filled). */
  confirmDisabled?: boolean
  onConfirm: () => void
  onClose: () => void
  t?: Translate
}

export default function ConfirmDialog({
  title,
  message,
  items,
  children,
  note,
  confirmLabel,
  cancelLabel,
  danger = false,
  working = false,
  workingLabel,
  confirmDisabled = false,
  onConfirm,
  onClose,
  t,
}: ConfirmDialogProps) {
  const T = (key: string, fallback: string): string => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }

  const primaryActionClass = `flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
    danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
  }`

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="sm"
      headerExtra={(
        <button
          type="button"
          onClick={onConfirm}
          disabled={working || confirmDisabled}
          className={`${primaryActionClass} min-h-9 max-w-24 truncate px-3 py-1.5 text-xs sm:hidden`}
        >
          {working ? (workingLabel || T('saving', 'Saving...')) : (confirmLabel || T('confirm', 'Confirm'))}
        </button>
      )}
    >
      <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
        {danger ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <div className="min-w-0 font-medium text-red-800 dark:text-red-300">
              {message || T('are_you_sure', 'Are you sure?')}
            </div>
          </div>
        ) : message ? (
          <p className="font-medium text-gray-900 dark:text-gray-100">{message}</p>
        ) : null}

        {items && items.length ? (
          <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700/60 dark:border-gray-700">
            {items.map((item, index) => (
              <div key={index} className="flex items-start justify-between gap-3 px-3 py-2">
                <dt className="flex-shrink-0 text-xs text-gray-500 dark:text-gray-400">{item.label}</dt>
                <dd className="min-w-0 break-words text-right font-medium text-gray-900 dark:text-gray-100">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {children}

        {note ? <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p> : null}

        <div className="sticky bottom-0 -mx-5 -mb-5 hidden gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800 sm:flex">
          <button
            type="button"
            onClick={onConfirm}
            disabled={working || confirmDisabled}
            className={`${primaryActionClass} flex-1`}
          >
            {working ? (workingLabel || T('saving', 'Saving...')) : (confirmLabel || T('confirm', 'Confirm'))}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={working}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300"
          >
            {cancelLabel || T('cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
