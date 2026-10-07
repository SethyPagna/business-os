import { useCallback, useEffect, useState } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import CornerUpRight from 'lucide-react/dist/esm/icons/corner-up-right.js'
import { useApp, type AppContextCoreValue } from '../../app/AppContextCore.tsx'
import {
  BRANCH_REDIRECT_TARGET_INVALID_CODE,
  defaultRedirectTarget,
  type BranchRedirectRequest,
} from '../../api/branchRedirect.ts'
import AppSelect from './AppSelect'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'

// Where a change addressed to a disabled branch should go (owner ruling 6 Oct 2026):
//   1. the float "<Old Shop> is disabled" / "Redirect to <LC Store>?" with the active branches to choose from (the
//      disabled branch is listed greyed out) and Back / Redirect on one row;
//   2. then the shared confirm dialog "Confirm redirect to <LC Store>?"; its Back returns to the float.
// Mounted by the app shell (useBranchRedirectQueue) while api/http.ts waits for the answer; the write is then sent
// again with the confirmed branch. Back answers null and nothing is written.

type Props = { request: BranchRedirectRequest; onAnswer: (target: number | null) => void }

const fill = (text: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(value), text)

export default function BranchRedirectHost({ request, onAnswer }: Props) {
  const { t } = useApp() as Pick<AppContextCoreValue, 't'>
  const tr = useCallback((key: string, fallback: string) => {
    const value = t?.(key)
    return value && value !== key ? value : fallback
  }, [t])
  const { detail, code } = request
  const initialTarget = detail.requested_target_id && detail.targets.some((row) => row.id === detail.requested_target_id)
    ? detail.requested_target_id
    : defaultRedirectTarget(detail)
  const [target, setTarget] = useState(initialTarget)
  const [step, setStep] = useState<'ask' | 'confirm'>('ask')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      if (step === 'confirm') setStep('ask')
      else onAnswer(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [step, onAnswer])

  const addressed = detail.addressed_branch_name || `#${detail.addressed_branch_id}`
  const disabledLabel = fill(tr('branch_redirect_disabled_option', '{branch} (disabled)'), { branch: addressed })
  const chosen = detail.targets.find((row) => row.id === target) || detail.targets[0]
  const chosenName = chosen.name || `#${chosen.id}`

  if (step === 'confirm') {
    return (
      <div data-branch-redirect-confirm="">
        <ConfirmDialog
          title={fill(tr('branch_redirect_confirm_title', 'Confirm redirect to {branch}?'), { branch: chosenName })}
          items={[
            { label: tr('branch_redirect_from', 'Addressed to'), value: disabledLabel },
            { label: tr('branch_redirect_to', 'Redirect to'), value: chosenName },
          ]}
          note={fill(tr('branch_redirect_note', '{from} keeps its own records. The stock and money of this change go to {to}.'), { from: addressed, to: chosenName })}
          confirmLabel={tr('confirm', 'Confirm')}
          cancelLabel={tr('back', 'Back')}
          layer="nested"
          keyboard
          t={(key) => t?.(key)}
          onConfirm={() => onAnswer(chosen.id)}
          onClose={() => setStep('ask')}
        />
      </div>
    )
  }

  return (
    <Modal
      title={fill(tr('branch_redirect_title', '{branch} is disabled'), { branch: addressed })}
      onClose={() => onAnswer(null)}
      size="sm"
      layer="nested"
      unsavedChanges="read-only"
    >
      <div data-branch-redirect-float="" className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <p className="font-medium text-gray-900 dark:text-gray-100">
          {fill(tr('branch_redirect_question', 'Redirect to {branch}?'), { branch: chosenName })}
        </p>
        {code === BRANCH_REDIRECT_TARGET_INVALID_CODE ? (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
            {tr('branch_redirect_target_invalid', 'The branch chosen for the redirect is not active or cannot take this change. Choose another branch. Nothing was changed.')}
          </p>
        ) : null}
        <div>
          <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{tr('branch_redirect_to', 'Redirect to')}</span>
          <AppSelect
            value={chosen.id}
            options={[
              ...detail.targets.map((row) => ({ value: row.id, label: row.name || `#${row.id}` })),
              { value: `disabled-${detail.addressed_branch_id}`, label: disabledLabel, disabled: true },
            ]}
            ariaLabel={tr('branch_redirect_to', 'Redirect to')}
            onChange={(value) => {
              const id = Number(value)
              if (detail.targets.some((row) => row.id === id)) setTarget(id)
            }}
          />
        </div>
        <div data-branch-redirect-actions="" className="flex items-stretch gap-2 pt-1">
          <button
            type="button"
            data-branch-redirect-back=""
            className="btn-secondary inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 px-2 text-sm font-semibold"
            onClick={() => onAnswer(null)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {tr('back', 'Back')}
          </button>
          <button
            type="button"
            data-branch-redirect-go=""
            className="btn-primary inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1 px-2 text-sm font-semibold"
            onClick={() => setStep('confirm')}
          >
            <CornerUpRight className="h-4 w-4" aria-hidden="true" />
            {tr('branch_redirect_action', 'Redirect')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
