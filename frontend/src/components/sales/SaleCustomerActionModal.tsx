import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal.tsx'

export type SaleCustomerChoice = {
  id: number
  name: string
  phone?: string | null
  membershipNumber?: string | null
}
type TranslateFn = (key: string, fallback: string) => string

export const SALE_CUSTOMER_SEARCH_DEBOUNCE_MS = 300

export function canonicalizeSaleCustomerPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (/^855\d{8,9}$/.test(digits)) return `0${digits.slice(3)}`
  return digits
}

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
  choices,
  currentCustomerName,
  resultsQuery = '',
  loading = false,
  error = '',
  saving,
  pendingOutcome = false,
  translate,
  onClose,
  onSearch,
  onAssign,
  onRetryPending,
  onDiscardPending,
}: {
  saleLabel: string
  choices: SaleCustomerChoice[]
  currentCustomerName?: string
  resultsQuery?: string
  loading?: boolean
  error?: string
  saving: boolean
  pendingOutcome?: boolean
  translate: TranslateFn
  onClose: () => void
  onSearch?: (query: string) => void
  onAssign: (customer: SaleCustomerChoice) => void
  onRetryPending?: () => void
  onDiscardPending?: () => void
}) {
  const [query, setQuery] = useState('')
  const requestedQueryRef = useRef('')
  const runSearch = (value: string): void => {
    requestedQueryRef.current = value
    onSearch?.(value)
  }
  useDebouncedSaleCustomerSearch(query, onSearch ? runSearch : undefined)
  const blocked = saving || pendingOutcome
  const normalizedQuery = query.trim().toLocaleLowerCase('en-US')
  const queryDigits = canonicalizeSaleCustomerPhone(query)
  const hasQuery = normalizedQuery.length >= 2 || queryDigits.length >= 3
  const errorMatchesQuery = !!error && query.trim() === requestedQueryRef.current
  // The server owns POS name/phone matching. A second substring filter hides
  // valid word-order/phone matches. Never show the preceding query's results.
  const matchingChoices = hasQuery && query.trim() === resultsQuery && !loading && !error ? choices : []

  return (
    <Modal title={`${translate('sale_customer_edit_title', 'Edit customer')} — ${saleLabel}`} onClose={onClose} closeDisabled={saving} unsavedChanges="read-only" size="sm">
      <div className="space-y-3">
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <span className="font-medium">{currentCustomerName || translate('walk_in', 'General')}</span>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            {translate('sale_customer_assignment_scope', 'Choose another customer for this sale and its linked returns. The old customer profile and unrelated transactions stay unchanged.')}
          </p>
        </div>

        {pendingOutcome ? (
          <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
            <p>{translate('sale_customer_link_unknown', 'The previous assignment has an unknown outcome. New edits are paused so the frozen request cannot be replaced.')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {onRetryPending ? <button type="button" className="btn-secondary" disabled={saving} onClick={onRetryPending}>{translate('sale_bulk_retry', 'Retry original request')}</button> : null}
              {onDiscardPending ? <button type="button" className="btn-secondary" disabled={saving} onClick={onDiscardPending}>{translate('sale_bulk_discard', 'Discard retry')}</button> : null}
            </div>
          </div>
        ) : null}

        {onSearch ? (
          <>
            <div>
              <label htmlFor="sale-customer-lookup" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{translate('customer', 'Customer')}</label>
              <input
                id="sale-customer-lookup"
                name="sale_customer_lookup"
                className="input w-full"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={translate('sale_customer_lookup', 'Search by name or phone')}
                autoComplete="off"
                autoFocus
                disabled={blocked}
              />
              <p className="mt-1 text-xs text-gray-500">{translate('sale_customer_lookup_hint', 'Phone is the primary match. You can also search by name and choose the matching customer.')}</p>
            </div>
            <div className="max-h-52 space-y-1 overflow-auto">
              {matchingChoices.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-950/30"
                  disabled={blocked}
                  onClick={() => onAssign(customer)}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-sm font-medium">{customer.phone || translate('sale_customer_no_phone', 'No phone')}</span>
                    <span className="block truncate text-xs text-gray-500">{customer.name}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-gray-500">
                    {customer.membershipNumber || translate('sale_customer_no_membership', 'No membership')}
                  </span>
                </button>
              ))}
              {loading ? <p role="status" className="px-2 py-3 text-sm text-gray-500">{translate('loading', 'Loading...')}</p> : null}
              {errorMatchesQuery ? <div role="alert" className="px-2 py-3 text-sm text-red-600">{error}<button type="button" className="btn-secondary ml-2" disabled={blocked} onClick={() => runSearch(query.trim())}>{translate('retry', 'Retry')}</button></div> : null}
              {hasQuery && query.trim() === resultsQuery && !loading && !error && !matchingChoices.length ? (
                <p className="px-2 py-3 text-sm text-gray-500">{translate('sale_customer_create_contacts', 'No existing customer was found. Creating a new customer requires Contacts add access, as in POS. Add the customer in Contacts, then search again.')}</p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="rounded-lg border p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {translate('perm_view_only_action', 'You do not have permission to perform this action.')}
          </p>
        )}
      </div>
    </Modal>
  )
}
