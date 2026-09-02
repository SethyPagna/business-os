import type { RenameImpact } from '../../api/renameCascadeTransport.ts'
import { createPortal } from 'react-dom'

// D6: the before -> after rename dialog. Shows what the rename touches
// (real counts from /api/products/rename-impact) and asks what happens to
// the attached rows: carry them all to the new name, keep a copy (the new
// name starts fresh, the old keeps its rows), or cancel-go-back. Pure
// presentational -- the caller decides which choices apply to its surface
// (e.g. a free-text brand has no meaningful "copy").

export type RenameCascadeChoice = 'carry' | 'copy' | 'only' | 'cancel'

export type RenameCascadeRequest = {
  kind: RenameImpact['kind']
  from: string
  to: string
  impact: RenameImpact
  // which non-cancel choices this surface offers, in render order
  choices: Array<Exclude<RenameCascadeChoice, 'cancel'>>
}

function impactSummary(impact: RenameImpact, t: (key: string, fallback?: string) => string): string[] {
  const lines: string[] = []
  const attachedProducts = impact.products_primary + impact.products_secondary
  if (Number(impact.linked_records || 0) > 0) {
    lines.push(`${impact.linked_records} ${t('rename_linked_records') || 'linked live records'}`)
  }
  if (impact.kind === 'product_name') {
    lines.push(`${impact.group_rows} ${t('rename_group_rows') || 'product rows share this name (one grouped product)'}`)
  } else if (attachedProducts > 0) {
    lines.push(`${attachedProducts} ${t('rename_attached_products') || 'attached products'}${impact.products_secondary ? ` (${impact.products_secondary} ${t('rename_secondary_note') || 'as a secondary value'})` : ''}`)
  }
  if (impact.batches > 0) lines.push(`${impact.batches} ${t('rename_attached_batches') || 'stock batches carry this supplier'}`)
  if (impact.target_exists) lines.push(t('rename_target_exists') || 'The new name already exists — carrying will merge into it.')
  if (impact.historical_snapshots_preserved?.length) {
    lines.push(`${t('rename_history_preserved') || 'Point-in-time history stays unchanged'}: ${impact.historical_snapshots_preserved.join(', ')}`)
  }
  if (!lines.length) lines.push(t('rename_nothing_attached') || 'Nothing else is attached — the rename only affects this record.')
  return lines
}

const CHOICE_TEXT: Record<Exclude<RenameCascadeChoice, 'cancel'>, { key: string; fallback: string; descKey: string; descFallback: string }> = {
  carry: {
    key: 'rename_choice_carry', fallback: 'Carry everything to the new name',
    descKey: 'rename_choice_carry_desc', descFallback: 'Every attached row follows the rename. History (past sales, movements) keeps the old text.',
  },
  copy: {
    key: 'rename_choice_copy', fallback: 'Keep a copy — new is new',
    descKey: 'rename_choice_copy_desc', descFallback: 'The old name stays with everything attached to it; the new name starts fresh and empty.',
  },
  only: {
    key: 'rename_choice_only', fallback: 'Only this one',
    descKey: 'rename_choice_only_desc', descFallback: 'Just this record changes; the others keep the old name (they split from it).',
  },
}

export default function RenameCascadeModal({
  request,
  busy = false,
  t,
  onChoose,
}: {
  request: RenameCascadeRequest | null
  busy?: boolean
  t: (key: string, fallback?: string) => string
  onChoose: (choice: RenameCascadeChoice) => void
}) {
  if (!request) return null
  const lines = impactSummary(request.impact, t)
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !busy && onChoose('cancel')}>
      <div className="max-h-[min(88vh,34rem)] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:max-w-md sm:rounded-2xl fade-in" onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-gray-200 p-3 dark:border-gray-700">
          <h3 className="font-bold text-gray-900 dark:text-white">{t('rename_cascade_title') || 'Rename — what happens to the rest?'}</h3>
          <p className="mt-2 text-sm">
            <span className="line-through text-gray-400">{request.from}</span>
            <span className="mx-2 text-gray-400">→</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{request.to}</span>
          </p>
        </div>
        <div className="space-y-2 p-3">
          <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
            {lines.map((line) => <li key={line}>• {line}</li>)}
          </ul>
          <div className="space-y-2">
            {request.choices.map((choice) => {
              const text = CHOICE_TEXT[choice]
              return (
                <button
                  key={choice}
                  type="button"
                  disabled={busy}
                  onClick={() => onChoose(choice)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-left transition-colors hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50 dark:border-gray-600 dark:hover:border-blue-500 dark:hover:bg-blue-900/20"
                >
                  <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">{t(text.key) || text.fallback}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t(text.descKey) || text.descFallback}</div>
                </button>
              )
            })}
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose('cancel')}
              className="w-full p-2.5 rounded-xl text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors disabled:opacity-50"
            >
              {t('rename_choice_cancel') || 'Cancel — go back'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
