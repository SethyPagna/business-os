import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal.tsx'

export type SaleCustomerChoice = { id: number; name: string; phone?: string | null }
type TranslateFn = (key: string, fallback: string) => string

export const SALE_CUSTOMER_SEARCH_DEBOUNCE_MS = 300

export function useDebouncedSaleCustomerSearch(query: string, onSearch?: (query: string) => void): void {
  const firstRenderRef = useRef(true)
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return undefined
    }
    if (!onSearchRef.current) return undefined
    const timer = window.setTimeout(() => onSearchRef.current?.(query.trim()), SALE_CUSTOMER_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, !!onSearch])
}

export default function SaleCustomerActionModal({
  saleLabel,
  currentName,
  hasCurrentCustomer,
  choices,
  saving,
  pendingOutcome = false,
  createRecovery = null,
  translate,
  onClose,
  onSearch,
  onReplace,
  onRemove,
  onCreate,
  onEdit,
  onClearCreateRecovery,
  onRetryPending,
  onDiscardPending,
}: {
  saleLabel: string
  currentName?: string | null
  hasCurrentCustomer: boolean
  choices: SaleCustomerChoice[]
  saving: boolean
  pendingOutcome?: boolean
  createRecovery?: { name: string; query: string } | null
  translate: TranslateFn
  onClose: () => void
  onSearch?: (query: string) => void
  onReplace: (customer: SaleCustomerChoice) => void
  onRemove: () => void
  onCreate?: () => void
  onEdit?: () => void
  onClearCreateRecovery?: () => void
  onRetryPending?: () => void
  onDiscardPending?: () => void
}) {
  const [query, setQuery] = useState(createRecovery?.query || '')
  useEffect(() => {
    if (createRecovery?.query) setQuery(createRecovery.query)
  }, [createRecovery?.query])
  useDebouncedSaleCustomerSearch(query, onSearch)
  const blocked = saving || pendingOutcome

  return (
    <Modal title={`${translate('sale_customer_action_title', 'Customer')} — ${saleLabel}`} onClose={onClose} closeDisabled={saving} unsavedChanges="read-only" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {translate('sale_customer_link_scope', 'Replace customer and Remove link change only this sale and returns linked to it. The customer profile and unrelated transactions stay unchanged.')}
        </p>
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <span className="text-gray-500">{translate('sale_customer_current_label', 'Current')}: </span>
          {hasCurrentCustomer ? currentName : translate('sale_customer_none_linked', 'No customer linked')}
        </div>

        {pendingOutcome ? (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            <p>{translate('sale_customer_link_unknown', 'The previous link change has an unknown outcome. New customer actions are paused so the frozen request cannot be replaced.')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {onRetryPending ? <button type="button" className="btn-secondary" disabled={saving} onClick={onRetryPending}>{translate('sale_bulk_retry', 'Retry original request')}</button> : null}
              {onDiscardPending ? <button type="button" className="btn-secondary" disabled={saving} onClick={onDiscardPending}>{translate('sale_bulk_discard', 'Discard retry')}</button> : null}
            </div>
          </div>
        ) : null}

        {createRecovery ? (
          <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            {translate('sale_customer_create_unknown', 'The create request may have succeeded. Do not create it again. Search for the customer and link the matching record after checking Contacts.')}
            <div className="mt-1 font-medium">{createRecovery.name}</div>
            {onClearCreateRecovery ? <button type="button" className="btn-secondary mt-2" disabled={saving} onClick={onClearCreateRecovery}>{translate('sale_customer_create_checked', 'I checked Contacts — allow create again')}</button> : null}
          </div>
        ) : null}

        {onSearch ? (
          <>
            <input
              className="input w-full"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={translate('sale_customer_find', 'Find by name, phone, or membership number')}
              autoFocus
            />
            <div className="max-h-52 space-y-1 overflow-auto">
              {choices.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-950/30"
                  disabled={blocked}
                  onClick={() => onReplace(customer)}
                >
                  <span>{customer.name}</span>
                  <span className="text-xs text-gray-500">{customer.phone || ''}</span>
                </button>
              ))}
              {!choices.length ? <p className="px-2 py-3 text-sm text-gray-500">{query ? translate('sale_customer_no_matches', 'No matching customers.') : translate('sale_customer_no_choices', 'No customers available.')}</p> : null}
            </div>
          </>
        ) : (
          <p className="rounded-lg border p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {translate('sale_customer_directory_unavailable', 'Customer search needs Contacts view permission. Remove link remains available for this sale.')}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-3 dark:border-gray-700">
          {onCreate && !createRecovery ? <button type="button" className="btn-primary" disabled={blocked} onClick={onCreate}>{translate('sale_customer_create', 'Create customer')}</button> : null}
          {hasCurrentCustomer && onEdit ? <button type="button" className="btn-secondary" disabled={blocked} onClick={onEdit}>{translate('sale_customer_edit_name', 'Edit current name')}</button> : null}
          {hasCurrentCustomer ? <button type="button" className="btn-secondary text-red-600" disabled={blocked} onClick={onRemove}>{translate('sale_customer_remove_link', 'Remove link')}</button> : null}
        </div>
      </div>
    </Modal>
  )
}
