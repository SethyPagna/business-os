import { useState } from 'react'
import { CornerDownLeft, CornerDownRight, History } from 'lucide-react'
import { useApp } from '../../AppContext.jsx'

function formatHistoryList(items = []) {
  return items.map((item) => item?.label).filter(Boolean).slice(-3).reverse()
}

function formatServerStatus(item, T) {
  if (item?.status === 'undoable') return T('undo_available', 'Undo available')
  if (item?.status === 'redoable') return T('redo_available', 'Redo available')
  if (item?.status === 'failed') return T('failed', 'Failed')
  return T('recorded', 'Recorded')
}

export default function ActionHistoryBar({
  history,
  align = 'left',
  className = '',
  t,
}) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  if (!history) return null

  const T = (key, fallback) => {
    if (typeof t === 'function') return t(key) || fallback
    if (typeof app?.t === 'function') return app.t(key) || fallback
    return fallback
  }
  const undoItems = formatHistoryList(history.undoItems)
  const redoItems = formatHistoryList(history.redoItems)
  const recordedItems = Array.isArray(history.serverItems) ? history.serverItems.slice(0, 3) : []
  const wrapperAlign = align === 'right' ? 'justify-end' : 'justify-start'
  const menuPosition = align === 'right'
    ? 'right-0'
    : 'left-0'
  const hasItems = !!((history.undoItems || []).length || (history.redoItems || []).length || recordedItems.length)

  return (
    <div className={`relative flex w-full min-w-0 flex-wrap items-center gap-2 ${wrapperAlign} ${className}`.trim()}>
      <div className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-2 py-1.5 text-xs text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 sm:gap-2 sm:px-2.5">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => setOpen((current) => !current)}
          title={T('history', 'History')}
          aria-expanded={open}
        >
          <History className="h-3.5 w-3.5 text-slate-400" />
          <span className="hidden sm:inline">{T('history', 'History')}</span>
        </button>
        {history.isAdmin && Array.isArray(history.userOptions) && history.userOptions.length ? (
          <select
            className="max-w-[7.5rem] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 sm:max-w-32"
            value={history.userFilter || 'all'}
            onChange={(event) => history.setUserFilter?.(event.target.value)}
            title={T('filter_by_user', 'Filter by user')}
          >
            <option value="all">{T('all_users', 'All users')}</option>
            {history.userOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name || option.username || `User ${option.id}`}</option>
            ))}
          </select>
        ) : null}
        <div className="hidden min-w-0 items-center gap-2 md:flex">
          {undoItems.length ? <span className="truncate text-slate-500">{T('undo', 'Undo')}: {undoItems.join(' / ')}</span> : null}
          {redoItems.length ? <span className="truncate text-slate-400">{T('redo', 'Redo')}: {redoItems.join(' / ')}</span> : null}
          {!undoItems.length && !redoItems.length && recordedItems.length ? <span className="truncate text-slate-500">{recordedItems[0]?.label}</span> : null}
          {!undoItems.length && !redoItems.length && !recordedItems.length ? <span>{T('no_recent_actions', 'No recent actions')}</span> : null}
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => history.undo()}
          disabled={!history.canUndo}
          title={history.lastUndoLabel ? `${T('undo', 'Undo')} ${history.lastUndoLabel}` : T('undo', 'Undo')}
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{T('undo', 'Undo')}</span>
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          onClick={() => history.redo()}
          disabled={!history.canRedo}
          title={history.lastRedoLabel ? `${T('redo', 'Redo')} ${history.lastRedoLabel}` : T('redo', 'Redo')}
        >
          <CornerDownRight className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{T('redo', 'Redo')}</span>
        </button>
      </div>

      {open ? (
        <div className={`absolute ${menuPosition} top-full z-40 mt-2 w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-2 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900`}>
          {!hasItems ? (
            <div className="px-3 py-2 text-slate-500 dark:text-slate-400">{T('no_recent_actions', 'No recent actions')}</div>
          ) : null}
          {(history.undoItems || []).slice(-3).reverse().map((item) => (
            <button
              key={`undo-${item.id}`}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              disabled={!!history.busy}
              onClick={() => { setOpen(false); history.undo(item.id) }}
            >
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{item.label}</span>
              <span className="rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-200">{T('undo', 'Undo')}</span>
            </button>
          ))}
          {(history.redoItems || []).slice(-3).reverse().map((item) => (
            <button
              key={`redo-${item.id}`}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
              disabled={!!history.busy}
              onClick={() => { setOpen(false); history.redo(item.id) }}
            >
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{item.label}</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">{T('redo', 'Redo')}</span>
            </button>
          ))}
          {recordedItems.map((item) => (
            <div
              key={`recorded-${item.id}`}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left"
            >
              <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{item.label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{formatServerStatus(item, T)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
