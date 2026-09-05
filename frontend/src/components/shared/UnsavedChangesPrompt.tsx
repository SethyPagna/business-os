import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import type { CloseGuard } from '../../utils/useCloseGuard.ts'
import MinimizeButton from './MinimizeButton.tsx'

// S4-21: the one prompt raised when a modal with unsaved changes is closed.
//
// Deliberately NOT built on shared/Modal.tsx: Modal itself raises this, and
// a component importing the component that imports it is a module cycle
// waiting to bite. It is a small self-contained overlay instead, portalled
// to document.body and layered ABOVE both modal layers (z-1050 default,
// z-1070 nested) so it is never the thing hidden behind what it is asking
// about.
//
// The button set is not decided here -- `guard.options` comes from the one
// constant in utils/closeGuard.ts (UNSAVED_CLOSE_OPTION_SET). This file
// only knows how to render each option it is handed.

const useApp = useAppHook as unknown as () => { t: (key: string) => string }

// `items` is how a modal that knows something CONCRETE about what is at
// risk ("3 failed, 12 done") says so, without growing a private copy of
// this dialog. It renders in the same label/value idiom ConfirmDialog uses,
// so the two read alike.
export type UnsavedChangesPromptItem = { label: ReactNode; value: ReactNode }

export default function UnsavedChangesPrompt({ guard, items }: { guard: CloseGuard; items?: UnsavedChangesPromptItem[] }) {
  const { t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  if (!guard.promptOpen) return null

  const node = (
    <div
      className="modal-viewport-safe pointer-events-auto fixed inset-0 z-[1080] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      // A React portal bubbles its events up the REACT tree, not the DOM
      // tree. Several hosts (ReceiveBatchModal, TransferModal, ...) put
      // `onClick={close}` on their backdrop, so without this every click
      // inside the prompt -- "Back" included -- would ALSO re-trigger the
      // host's dismissal and the prompt could never be answered. Stopped
      // once, here, so no host has to remember.
      onClick={(event) => event.stopPropagation()}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            {/* leading-relaxed, not the default tight line box: Khmer
                ascenders/descenders (ុ ់ ៍) are clipped by a line box sized
                to Latin text. */}
            <h2 className="text-base font-bold leading-relaxed text-gray-900 dark:text-white">
              {tr('unsaved_changes_title', 'Discard unsaved changes?')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
              {tr('unsaved_changes_body', 'This form has changes that were never saved. Go back to keep them, or discard them and close.')}
            </p>
            {guard.workLabel ? (
              <p className="mt-2 flex items-center gap-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                <span className="min-w-0 break-words">{guard.workLabel}</span>
              </p>
            ) : null}
          </div>
          {guard.preserveAndMinimize ? (
            <MinimizeButton
              disabled={guard.saving}
              onMinimize={guard.preserveAndMinimize}
              tr={(key, fallbackEn) => tr(key, fallbackEn)}
            />
          ) : null}
        </div>
        {items && items.length ? (
          <dl className="mt-3 space-y-1 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-900/40">
            {items.map((item, index) => (
              <div key={index} className="flex items-start justify-between gap-3">
                <dt className="min-w-0 leading-relaxed text-gray-500 dark:text-gray-400">{item.label}</dt>
                <dd className="shrink-0 font-medium leading-relaxed text-gray-900 dark:text-white">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {/* Actions at the end of the content, never beside a close control
            (S4-20's rule, applied to this dialog too). */}
        <div className="mt-4 flex flex-col gap-2">
          {guard.options.map((option) => {
            if (option === 'save') {
              return (
                <button
                  key="save"
                  type="button"
                  className="btn-primary min-h-11 w-full text-sm leading-relaxed"
                  disabled={guard.saving}
                  onClick={guard.saveAndClose}
                >
                  {guard.saving ? tr('saving', 'Saving...') : tr('save_and_close', 'Save & Close')}
                </button>
              )
            }
            if (option === 'discard') {
              return (
                <button
                  key="discard"
                  type="button"
                  className="min-h-11 w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium leading-relaxed text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-900/20"
                  disabled={guard.saving}
                  onClick={guard.discardAndClose}
                >
                  {tr('discard_changes', 'Discard changes')}
                </button>
              )
            }
            return (
              <button
                key="back"
                type="button"
                className="btn-secondary min-h-11 w-full text-sm leading-relaxed"
                disabled={guard.saving}
                onClick={guard.dismissPrompt}
              >
                {tr('back', 'Back')}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return node
  return createPortal(node, document.body)
}
