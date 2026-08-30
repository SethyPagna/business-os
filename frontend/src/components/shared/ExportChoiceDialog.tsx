import { useState, type ReactNode } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import Modal from './Modal'

// The floating "which export?" dialog (Aug 30 redesign: every export opens a
// float dialog with its options — nothing downloads straight off a toolbar
// menu). Pages whose exports are tabular rows already get this via
// ExportOptionsDialog (format + column picks); THIS dialog is for pages that
// offer several distinct REPORTS instead (the Dashboard's package / KPIs /
// charts / breakdowns), where the choice is "which report", not "which
// columns". Rows run their own export when tapped; async exporters show a
// spinner on the row and the dialog closes when the export has started.
export type ExportChoice = {
  id: string
  label: ReactNode
  hint?: ReactNode
  onClick: () => void | Promise<void>
}

export type ExportChoiceGroup = {
  id: string
  label?: ReactNode
  choices: ExportChoice[]
}

export default function ExportChoiceDialog({ title, groups, onClose }: {
  title: string
  groups: ExportChoiceGroup[]
  onClose: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const run = async (choice: ExportChoice) => {
    if (busyId) return
    setBusyId(choice.id)
    try {
      await choice.onClick()
      onClose()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal title={title} onClose={onClose} size="sm">
      <div className="space-y-3">
        {groups.map((group) => (
          <div key={group.id}>
            {group.label ? (
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{group.label}</p>
            ) : null}
            <div className="space-y-1">
              {group.choices.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  disabled={!!busyId}
                  onClick={() => { void run(choice) }}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:bg-blue-50/60 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-blue-600 dark:hover:bg-blue-900/20"
                >
                  {busyId === choice.id
                    ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" aria-hidden="true" />
                    : <Download className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{choice.label}</span>
                    {choice.hint ? <span className="block truncate text-[11px] font-normal text-gray-400">{choice.hint}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
