import { useEffect, useMemo, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import Modal from '../shared/Modal'
import PortalMenu from '../shared/PortalMenu'
import PaginationControls, { paginateItems } from '../shared/PaginationControls.jsx'
import LoadingWatchdog from '../shared/LoadingWatchdog.jsx'
import { useApp } from '../../AppContext'

/**
 * 1. useContactSelection
 * 1.1 Centralizes table/card multi-select behavior for all contacts tabs.
 * 1.2 Drops stale selections when a filtered dataset removes rows from view.
 */
export function useContactSelection(rows = []) {
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const rowIds = useMemo(
    () => rows.map((row) => Number(row?.id)).filter((id) => Number.isFinite(id)),
    [rows],
  )

  useEffect(() => {
    setSelectedIds((previous) => {
      const validIds = new Set(rowIds)
      const nextIds = [...previous].filter((id) => validIds.has(Number(id)))
      if (nextIds.length === previous.size && nextIds.every((id) => previous.has(id))) return previous
      return new Set(nextIds)
    })
  }, [rowIds])

  const toggleOne = (id) => {
    const numericId = Number(id)
    if (!Number.isFinite(numericId)) return
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(numericId)) next.delete(numericId)
      else next.add(numericId)
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const selectAllProp = {
    checked: rowIds.length > 0 && selectedIds.size === rowIds.length,
    indeterminate: selectedIds.size > 0 && selectedIds.size < rowIds.length,
    onChange: (checked) => {
      if (!checked) {
        clearSelection()
        return
      }
      setSelectedIds(new Set(rowIds))
    },
  }

  return {
    selectedIds,
    setSelectedIds,
    toggleOne,
    clearSelection,
    selectAllProp,
  }
}

/**
 * 2. ThreeDotMenu
 * 2.1 Reusable row-action popup for customer/supplier/delivery lists.
 */
export function ThreeDotMenu({ onDetails, onEdit, onDelete }) {
  const { t } = useApp()
  const items = [
    onDetails && { label: t('details') || 'Details', onClick: onDetails },
    onEdit && { label: t('edit') || 'Edit', onClick: onEdit, color: 'blue' },
    onDelete && 'divider',
    onDelete && { label: t('delete') || 'Delete', onClick: onDelete, color: 'red' },
  ].filter(Boolean)

  const menuContent = ({ closeMenu }) => (
    <>
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2 dark:border-gray-700">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('actions') || 'Actions'}</div>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          onClick={closeMenu}
          aria-label={t('close') || 'Close'}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="py-1">
        {items.map((item, index) => (
          item === 'divider'
            ? <div key={`divider-${index}`} className="my-1 border-t border-gray-100 dark:border-gray-700" />
            : (
              <button
                key={`action-${index}`}
                type="button"
                className={`w-full px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                  item.color === 'red'
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                    : item.color === 'blue'
                      ? 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700'
                }`}
                onClick={() => {
                  closeMenu()
                  item.onClick?.()
                }}
              >
                {item.label}
              </button>
            )
        ))}
      </div>
    </>
  )

  return (
    <PortalMenu
      trigger={(
        <button
          type="button"
          aria-label={t('actions') || 'Actions'}
          name="contact_row_actions"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-zinc-700 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-gray-200"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      )}
      content={menuContent}
      menuClassName="min-w-[190px] p-0"
    />
  )
}

/**
 * 3. DetailModal
 * 3.1 Generic key-value detail viewer for all contacts entity types.
 */
export function DetailModal({ item, fields = [], onEdit, onDelete, onClose, t }) {
  const title = item?.name || (typeof t === 'function' ? (t('details') || 'Details') : 'Details')

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 dark:border-zinc-700">
          {fields.map(([label, value], index) => (
            <div
              key={`${String(label)}-${index}`}
              className="grid grid-cols-[140px,1fr] gap-3 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-zinc-800"
            >
              <div className="font-medium text-gray-500 dark:text-gray-400">{label || '-'}</div>
              <div className="whitespace-pre-line text-gray-800 dark:text-gray-200">{value || '-'}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onEdit}>{t?.('edit') || 'Edit'}</button>
          <button type="button" className="btn-secondary flex-1 border-red-300 text-red-600 dark:border-red-500/40 dark:text-red-400" onClick={onDelete}>{t?.('delete') || 'Delete'}</button>
          <button type="button" className="btn-primary flex-1" onClick={onClose}>{t?.('close') || 'Close'}</button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * 4. ContactTable
 * 4.1 Shared desktop table shell + mobile card container for contacts tabs.
 */
export function ContactTable({
  loading,
  rows = [],
  emptyLabel = 'No records',
  columns = [],
  selectAll,
  renderRow,
  renderCard,
  totalCount,
  page: controlledPage,
  pageSize: controlledPageSize,
  onPageChange: onControlledPageChange,
  onPageSizeChange: onControlledPageSizeChange,
  onRetry,
  loadingLabel = 'Loading contacts...',
  loadingDetails = 'Fetching contact records and grouped filters.',
  t,
}) {
  const selectAllRef = useRef(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const usingControlledPagination = Number.isFinite(Number(controlledPage)) && Number.isFinite(Number(controlledPageSize))
  const activePage = usingControlledPagination ? Number(controlledPage) : page
  const activePageSize = usingControlledPagination ? Number(controlledPageSize) : pageSize
  const skeletonRows = useMemo(() => Array.from({ length: 8 }, (_, index) => index), [])
  const totalItems = Number.isFinite(Number(totalCount)) ? Number(totalCount) : rows.length
  const pagedRows = useMemo(
    () => (usingControlledPagination ? rows : paginateItems(rows, activePage, activePageSize)),
    [activePage, activePageSize, rows, usingControlledPagination],
  )

  useEffect(() => {
    if (!selectAllRef.current) return
    selectAllRef.current.indeterminate = !!selectAll?.indeterminate
  }, [selectAll?.indeterminate])

  useEffect(() => {
    if (usingControlledPagination) return
    setPage(1)
  }, [rows, totalItems, usingControlledPagination])

  if (loading && !rows.length) {
    return (
      <div className="space-y-3">
        <LoadingWatchdog
          loading
          timeoutMs={5000}
          label={loadingLabel}
          details={loadingDetails}
          onRetry={onRetry}
        />
        <div className="hidden overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-700 md:block">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-gray-400">
              <tr>
                <th className="w-10 px-3 py-2">
                  <div className="h-4 w-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </th>
                {columns.map((column, index) => (
                  <th key={`contact-skeleton-head-${index}`} className="px-3 py-2">
                    {column}
                  </th>
                ))}
                <th className="w-12 px-3 py-2 text-right">
                  <div className="ml-auto h-4 w-6 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {skeletonRows.map((row) => (
                <tr key={`contact-skeleton-row-${row}`} className="animate-pulse">
                  <td className="px-3 py-3">
                    <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                  </td>
                  {columns.map((_, index) => (
                    <td key={`contact-skeleton-cell-${row}-${index}`} className="px-3 py-3">
                      <div className={`h-4 rounded bg-slate-100 dark:bg-slate-800 ${index === 0 ? 'w-32' : index >= columns.length - 2 ? 'w-20' : 'w-24'}`} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right">
                    <div className="ml-auto h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 md:hidden">
          {skeletonRows.slice(0, 6).map((row) => (
            <div key={`contact-mobile-skeleton-${row}`} className="card animate-pulse p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-5 w-36 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-4 w-24 rounded bg-slate-100 dark:bg-slate-800" />
                </div>
                <div className="h-8 w-8 rounded-lg bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="h-4 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-4 rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-zinc-700 dark:text-gray-400">
        {emptyLabel}
      </div>
    )
  }

  return (
    <>
      <PaginationControls
        className="mb-2"
        page={activePage}
        pageSize={activePageSize}
        totalItems={totalItems}
        label={typeof t === 'function' ? (t('records') || 'records') : 'records'}
        t={t}
        onPageChange={usingControlledPagination ? onControlledPageChange : setPage}
        onPageSizeChange={(size) => {
          if (usingControlledPagination) {
            onControlledPageSizeChange?.(size)
            onControlledPageChange?.(1)
            return
          }
          setPageSize(size)
          setPage(1)
        }}
      />
      {loading ? (
        <div className="mb-2 rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-600 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
          Refreshing...
        </div>
      ) : null}
      <div className="hidden overflow-x-auto rounded-xl border border-gray-200 dark:border-zinc-700 md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-zinc-800 dark:text-gray-400">
            <tr>
              <th className="w-10 px-3 py-2">
                <label htmlFor="contacts-select-all" className="sr-only">Select all contacts</label>
                <input
                  ref={selectAllRef}
                  id="contacts-select-all"
                  name="contacts_select_all"
                  aria-label="Select all contacts"
                  type="checkbox"
                  className="h-4 w-4 rounded"
                  checked={!!selectAll?.checked}
                  onChange={(event) => selectAll?.onChange?.(event.target.checked)}
                />
              </th>
              {columns.map((column) => (
                <th key={String(column)} className="px-4 py-2">{column}</th>
              ))}
              <th className="w-12 px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
            {pagedRows.map((row) => renderRow?.(row))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {pagedRows.map((row) => renderCard?.(row))}
      </div>
    </>
  )
}

