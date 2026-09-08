import { useEffect, useRef, useState } from 'react'
import Modal from '../shared/Modal.tsx'
import { formatPhoneInputElement, handlePhoneInputBeforeInput, handlePhoneInputKeyDown } from '../../utils/phoneInput.ts'

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
  saving: boolean
  pendingOutcome?: boolean
  translate: TranslateFn
  onClose: () => void
  onSearch?: (phone: string) => void
  onAssign: (customer: SaleCustomerChoice) => void
  onRetryPending?: () => void
  onDiscardPending?: () => void
}) {
  const [phone, setPhone] = useState('')
  useDebouncedSaleCustomerSearch(phone, onSearch ? (query) => onSearch(canonicalizeSaleCustomerPhone(query)) : undefined)
  const blocked = saving || pendingOutcome
  const phoneKey = canonicalizeSaleCustomerPhone(phone)
  const hasPhoneQuery = phoneKey.length >= 3
  const exactPhoneChoices = hasPhoneQuery
    ? choices.filter((customer) => canonicalizeSaleCustomerPhone(customer.phone) === phoneKey)
    : []

  return (
    <Modal title={`${translate('sale_customer_edit_title', 'Edit customer')} — ${saleLabel}`} onClose={onClose} closeDisabled={saving} unsavedChanges="read-only" size="sm">
      <div className="space-y-3">
        <div className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <span className="font-medium">{translate('sale_customer_general_label', 'General (anonymous)')}</span>
          <p className="mt-1 text-gray-500 dark:text-gray-400">
            {translate('sale_customer_general_scope', 'General has no customer profile. Enter a phone number to find and assign an existing customer. The sale and its linked returns will use that customer; unrelated transactions stay unchanged.')}
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
              <label htmlFor="sale-customer-phone" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{translate('phone_number', 'Phone number')}</label>
              <input
                id="sale-customer-phone"
                name="sale_customer_phone_lookup"
                className="input w-full"
                value={phone}
                onChange={(event) => setPhone(formatPhoneInputElement(event.currentTarget))}
                onKeyDown={(event) => handlePhoneInputKeyDown(event, (value) => setPhone(value))}
                onBeforeInput={(event) => handlePhoneInputBeforeInput(event, (value) => setPhone(value))}
                placeholder={translate('sale_customer_phone_lookup', 'Find an existing customer by phone')}
                inputMode="tel"
                autoComplete="tel"
                autoFocus
              />
              <p className="mt-1 text-xs text-gray-500">{translate('sale_customer_phone_primary_hint', 'Phone is the customer identity used for this lookup. Name is shown second to confirm the match.')}</p>
            </div>
            <div className="max-h-52 space-y-1 overflow-auto">
              {exactPhoneChoices.map((customer) => (
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
              {hasPhoneQuery && !exactPhoneChoices.length ? (
                <p className="px-2 py-3 text-sm text-gray-500">{translate('sale_customer_phone_not_found', 'No existing customer was found. Add the customer in Contacts, then return here and search again.')}</p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="rounded-lg border p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {translate('sale_customer_assignment_permission', 'Assigning an existing customer needs Contacts view permission.')}
          </p>
        )}
      </div>
    </Modal>
  )
}
