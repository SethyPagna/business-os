import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import Search from 'lucide-react/dist/esm/icons/search.js'
import X from 'lucide-react/dist/esm/icons/x.js'

// Generic contact shape this picker needs -- customers/suppliers/delivery
// contacts all satisfy this already (see CustomerRow/SupplierRow/
// DeliveryContact in their respective tabs).
export type ContactPickerOption = {
  id: string | number
  name?: string | null
  phone?: string | null
  membership_number?: string | null
}

type ContactPickerProps = {
  id?: string
  contacts: ContactPickerOption[]
  value: string | number | null | undefined
  onChange: (id: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  emptyLabel?: string
  maxResults?: number
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

// Reuses AppSelect.tsx's own portal/fixed-position/outside-click pattern
// (see that file's `reposition`/`closeIfOutside` logic) so this drops into
// modals with `overflow-y-auto` wrappers -- like NewSupplierReturnModal's
// `modal-scroll` container -- without its dropdown getting clipped, the
// same problem an inline `position: absolute` dropdown (POS's own inline
// customer-search pattern) would otherwise hit inside a scrolling modal.
export default function ContactPicker({
  id,
  contacts,
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = '',
  disabled = false,
  emptyLabel = 'No matches',
  maxResults = 8,
}: ContactPickerProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 200 })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const frameRef = useRef(0)

  const selected = useMemo(
    () => contacts.find((c) => String(c.id) === String(value ?? '')) || null,
    [contacts, value],
  )

  // Typing filters; an empty query with the field focused shows the first
  // `maxResults` contacts (alphabetical, since callers already pass
  // name-sorted lists -- see contactReadTransport.ts's `ORDER BY
  // lower(name)` on every contact GET) so the list isn't empty on first
  // focus the way POS's own search-only autocomplete is.
  const results = useMemo(() => {
    const q = normalize(query)
    const pool = !q
      ? contacts
      : contacts.filter((c) => normalize(c.name).includes(q) || normalize(c.phone).includes(q) || normalize(c.membership_number).includes(q))
    return pool.slice(0, maxResults)
  }, [contacts, query, maxResults])

  const reposition = useCallback(() => {
    const root = rootRef.current
    if (!root || !document.body.contains(root)) {
      setOpen(false)
      return
    }
    const rect = root.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight || Math.min(256, 44 * Math.max(1, results.length))
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    let top = rect.bottom + 6
    if (top + menuHeight > viewportHeight - 8) top = Math.max(8, rect.top - menuHeight - 6)
    const width = Math.max(rect.width, 200)
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
    setPosition({ top, left, width })
  }, [results.length])

  useEffect(() => {
    if (!open) return undefined
    const scheduleReposition = () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0
        reposition()
      })
    }
    const closeIfOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const closeIfEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside)
    document.addEventListener('keydown', closeIfEscape)
    window.addEventListener('scroll', scheduleReposition, true)
    window.addEventListener('resize', scheduleReposition)
    scheduleReposition()
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
      document.removeEventListener('keydown', closeIfEscape)
      window.removeEventListener('scroll', scheduleReposition, true)
      window.removeEventListener('resize', scheduleReposition)
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    }
  }, [open, reposition])

  const choose = (contact: ContactPickerOption) => {
    onChange(String(contact.id))
    setQuery('')
    setOpen(false)
  }

  const clear = () => {
    onChange('')
    setQuery('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && results.length === 1) {
      event.preventDefault()
      choose(results[0])
    }
  }

  const displayValue = open ? query : (selected ? String(selected.name || '') : query)

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`.trim()} data-contact-picker-root="true">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          className="input w-full pl-8 pr-7 text-sm"
          placeholder={placeholder || 'Search by name or phone'}
          aria-label={ariaLabel}
          value={displayValue}
          disabled={disabled}
          onChange={(event) => { setQuery(event.target.value); if (value) onChange(''); if (!open) setOpen(true) }}
          onFocus={() => { setOpen(true); setTimeout(reposition, 0) }}
          onKeyDown={handleKeyDown}
        />
        {(selected || query) ? (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"
            aria-label="Clear selection"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className="max-h-[min(16rem,calc(var(--app-vh-100)_-_1rem))] overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white p-1 shadow-2xl shadow-slate-900/12 ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/35"
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, zIndex: 10000 }}
        >
          {results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-400">{emptyLabel}</div>
          ) : results.map((contact) => (
            <button
              key={String(contact.id)}
              type="button"
              role="option"
              aria-selected={String(contact.id) === String(value ?? '')}
              onClick={() => choose(contact)}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-blue-50 dark:text-slate-100 dark:hover:bg-blue-900/20"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{contact.name || `#${contact.id}`}</span>
              {contact.phone ? <span className="shrink-0 text-xs text-gray-400">{contact.phone}</span> : null}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
