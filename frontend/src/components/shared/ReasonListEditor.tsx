import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Check from 'lucide-react/dist/esm/icons/check.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ConfirmDialog from './ConfirmDialog'
import type { ConfirmRequest } from './useConfirmDialog.tsx'

// The one list editor behind every reason and label manager (stock reasons,
// return reasons, expense labels), so the three look and behave the same:
// an add row, one row per entry with the label in full, inline rename (the
// input replaces the label; Enter saves, Escape cancels) and a delete that
// always goes through the shared confirm dialog. Hosts keep their own data
// logic -- impact previews, linked-record replacement, types -- and hand the
// editor callbacks.

export type ReasonListItem = {
  id: string
  label: string
  /** Small second line under the label (usage count, mixed categories). */
  meta?: ReactNode
}

type Translate = (key: string, fallback: string) => string

export type ReasonListEditorProps<T extends ReasonListItem> = {
  items: T[]
  tr: Translate
  loading?: boolean
  /** Disables every control while the host writes. */
  busy?: boolean
  /** Controlled add-row text; omit onAdd to hide the add row (labels that come from records). */
  draft?: string
  onDraftChange?: (value: string) => void
  onAdd?: (label: string) => void | Promise<void>
  addPlaceholder?: string
  /** Resolves true when the rename landed, so the row leaves edit mode. */
  onRename?: (item: T, to: string) => boolean | void | Promise<boolean | void>
  onDelete?: (item: T) => void | Promise<void>
  /** The confirm shown before onDelete; defaults to a Delete review of the label. */
  deleteConfirm?: (item: T) => ConfirmRequest
  /** Extra per-row control placed before the icons (the expense type select). */
  renderExtra?: (item: T) => ReactNode
  emptyText?: ReactNode
  /** Reports typed-but-unsaved text (the add row or an open rename) to the host's close guard. */
  onDirtyChange?: (dirty: boolean) => void
}

export const normalizeReasonLabel = (value: string): string => value.trim().replace(/\s+/g, ' ')

// The awaitable confirm of useConfirmDialog.tsx, built on ConfirmDialog
// directly: that hook has its own chunk (it must stay off the storefront) whose
// import of ConfirmDialog points back into app-shared, so a shared/ file
// importing it closes a chunk cycle and the build refuses.
export function useAskConfirm(tr: Translate) {
  const [pending, setPending] = useState<(ConfirmRequest & { resolve: (confirmed: boolean) => void }) | null>(null)
  const pendingRef = useRef<typeof pending>(null)
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
  useEffect(() => () => { pendingRef.current?.resolve(false); pendingRef.current = null }, [])
  // Escape answers no here rather than closing the manager beneath.
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
      keyboard
      t={(key) => tr(key, key)}
      onConfirm={() => settle(true)}
      onClose={() => settle(false)}
    />
  ) : null
  return { askToConfirm, confirmDialog }
}
export default function ReasonListEditor<T extends ReasonListItem>({
  items, tr, loading = false, busy = false, draft = '', onDraftChange, onAdd, addPlaceholder,
  onRename, onDelete, deleteConfirm, renderExtra, emptyText, onDirtyChange,
}: ReasonListEditorProps<T>) {
  const { askToConfirm, confirmDialog } = useAskConfirm(tr)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editing = editingId ? items.find((item) => item.id === editingId) ?? null : null
  const renameDirty = Boolean(editing && normalizeReasonLabel(editValue) !== editing.label)
  const dirty = Boolean(normalizeReasonLabel(draft)) || renameDirty

  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => { if (editingId && !editing) setEditingId(null) }, [editing, editingId])

  const submitAdd = () => {
    const label = normalizeReasonLabel(draft)
    if (!label || busy || !onAdd) return
    void onAdd(label)
  }
  const startRename = (item: T) => { setEditingId(item.id); setEditValue(item.label) }
  const cancelRename = () => { setEditingId(null); setEditValue('') }
  const submitRename = async () => {
    if (!editing || !onRename || busy) return
    const to = normalizeReasonLabel(editValue)
    if (!to || to === editing.label) { cancelRename(); return }
    const done = await onRename(editing, to)
    if (done !== false) cancelRename()
  }
  const remove = async (item: T) => {
    if (!onDelete || busy) return
    const request = deleteConfirm?.(item) ?? {
      title: tr('delete', 'Delete'),
      message: tr('delete_saved_reason_confirm', 'Delete this saved reason?'),
      items: [{ label: tr('reason', 'Reason'), value: item.label }],
      confirmLabel: tr('delete', 'Delete'),
      danger: true,
    }
    if (!(await askToConfirm(request))) return
    await onDelete(item)
  }

  const renameLabel = tr('rename', 'Rename')
  const deleteLabel = tr('delete', 'Delete')
  const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-40'

  return (
    <div className="space-y-2" data-reason-list-editor="">
      {onAdd ? (
        <div className="flex min-w-0 gap-1.5">
          <input
            className="input h-9 min-w-0 flex-1 text-sm"
            value={draft}
            onChange={(event) => onDraftChange?.(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitAdd() } }}
            placeholder={addPlaceholder ?? tr('new_reason_placeholder', 'Add a reusable reason')}
            aria-label={addPlaceholder ?? tr('new_reason_placeholder', 'Add a reusable reason')}
            autoComplete="off"
            disabled={busy}
          />
          <button type="button" className="btn-primary h-9 shrink-0 px-4 text-sm" disabled={busy || !normalizeReasonLabel(draft)} onClick={submitAdd}>
            {tr('add', 'Add')}
          </button>
        </div>
      ) : null}
      <div className="max-h-[min(22rem,calc(55*var(--app-vh)))] space-y-1 overflow-y-auto">
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-400">{tr('loading', 'Loading…')}</div>
        ) : items.length ? items.map((item) => (
          <div key={item.id} data-reason-row="" className="flex min-w-0 items-center gap-1 rounded-lg border border-slate-200 py-1 pl-2.5 pr-1 dark:border-slate-700">
            {editingId === item.id ? (
              <>
                <input
                  className="input h-8 min-w-0 flex-1 text-sm"
                  value={editValue}
                  autoFocus
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void submitRename() }
                    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelRename() }
                  }}
                  aria-label={`${renameLabel} ${item.label}`}
                  disabled={busy}
                />
                <button type="button" className={`${iconButton} text-emerald-600 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950`} onClick={() => void submitRename()} disabled={busy || !normalizeReasonLabel(editValue)} aria-label={tr('save', 'Save')} title={tr('save', 'Save')}>
                  <Check className="h-4 w-4" />
                </button>
                <button type="button" className={`${iconButton} text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800`} onClick={cancelRename} disabled={busy} aria-label={tr('cancel', 'Cancel')} title={tr('cancel', 'Cancel')}>
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <div className="detail-scroll-text text-sm leading-relaxed text-slate-700 dark:text-slate-200">{item.label}</div>
                  {item.meta ? <div className="detail-scroll-text text-[11px] leading-relaxed text-slate-400">{item.meta}</div> : null}
                </div>
                {renderExtra?.(item)}
                {onRename ? (
                  <button type="button" className={`${iconButton} text-blue-600 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950`} onClick={() => startRename(item)} disabled={busy || editingId !== null} aria-label={`${renameLabel} ${item.label}`} title={renameLabel}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                ) : null}
                {onDelete ? (
                  <button type="button" className={`${iconButton} text-red-500 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950`} onClick={() => void remove(item)} disabled={busy || editingId !== null} aria-label={`${deleteLabel} ${item.label}`} title={deleteLabel}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </>
            )}
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-slate-300 py-6 text-center text-sm text-slate-400 dark:border-slate-700">
            {emptyText ?? tr('no_saved_reasons', 'No saved reasons yet for this workflow.')}
          </div>
        )}
      </div>
      {confirmDialog}
    </div>
  )
}
