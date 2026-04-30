import { CornerDownLeft, CornerDownRight, History } from 'lucide-react'

function formatHistoryList(items = []) {
  return items.map((item) => item?.label).filter(Boolean).slice(-3).reverse()
}

export default function ActionHistoryBar({
  history,
  align = 'left',
  className = '',
}) {
  if (!history) return null
  const undoItems = formatHistoryList(history.undoItems)
  const redoItems = formatHistoryList(history.redoItems)
  const wrapperAlign = align === 'right' ? 'justify-end' : 'justify-start'

  return (
    <div className={`flex flex-wrap items-center gap-2 ${wrapperAlign} ${className}`.trim()}>
      <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300">
        <History className="h-3.5 w-3.5 text-slate-400" />
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          {undoItems.length ? <span className="truncate text-slate-500">Undo: {undoItems.join(' · ')}</span> : null}
          {redoItems.length ? <span className="truncate text-slate-400">Redo: {redoItems.join(' · ')}</span> : null}
          {!undoItems.length && !redoItems.length ? <span>No recent actions</span> : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={history.undo}
          disabled={!history.canUndo}
          title={history.lastUndoLabel ? `Undo ${history.lastUndoLabel}` : 'Undo'}
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
          <span>Undo</span>
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={history.redo}
          disabled={!history.canRedo}
          title={history.lastRedoLabel ? `Redo ${history.lastRedoLabel}` : 'Redo'}
        >
          <CornerDownRight className="h-3.5 w-3.5" />
          <span>Redo</span>
        </button>
      </div>
    </div>
  )
}
