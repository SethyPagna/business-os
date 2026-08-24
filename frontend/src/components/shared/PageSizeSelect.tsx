import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'

// Replaces the old pattern of an AppSelect (presets) sitting next to a
// second, always-visible text input (custom value): two controls doing one
// job, and easy to miss that the little text box next to the dropdown was
// also a "per page" input. This merges them into a single control -- the
// presets are options in the dropdown, and "Custom" is simply the last
// option, expanding into its own number field in place when picked (or
// already showing that field if the current value isn't one of the
// presets). One click target, one concept, for admin pages and the public
// portal alike.

export interface PageSizeSelectProps {
  id?: string
  value: number
  options: number[]
  onChange: (value: number) => void
  ariaLabel?: string
  customLabel?: string
  maxValue?: number
  className?: string
  buttonClassName?: string
  menuClassName?: string
  optionClassName?: string
  disabled?: boolean
  usePortalMenu?: boolean
  allowCustom?: boolean
}

export default function PageSizeSelect({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  customLabel = 'Custom',
  maxValue = 500,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  optionClassName = '',
  disabled = false,
  usePortalMenu = true,
  allowCustom = true,
}: PageSizeSelectProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 160 })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const customInputRef = useRef<HTMLInputElement | null>(null)
  const frameRef = useRef(0)

  const safeValue = Math.max(1, Number(value) || options[0] || 1)
  const isPreset = options.includes(safeValue)
  const [customDraft, setCustomDraft] = useState(String(safeValue))

  useEffect(() => {
    if (!isPreset) setCustomDraft(String(safeValue))
  }, [safeValue, isPreset])

  const reposition = useCallback(() => {
    const root = rootRef.current
    if (!root || !document.body.contains(root)) {
      setOpen(false)
      return
    }
    const rect = root.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight || 260
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    let top = rect.bottom + 6
    if (top + menuHeight > viewportHeight - 8) top = Math.max(8, rect.top - menuHeight - 6)
    const width = Math.max(rect.width, 128)
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
    setPosition({ top, left, width })
  }, [])

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
    if (allowCustom && !isPreset) {
      // Custom is already the active selection -- put the cursor straight
      // into its field instead of making the person click it first.
      window.setTimeout(() => customInputRef.current?.focus(), 0)
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reposition, allowCustom])

  const choosePreset = (option: number) => {
    onChange(option)
    setOpen(false)
  }

  const commitCustom = (raw: string) => {
    const parsed = Number.parseInt(String(raw || '').trim(), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setCustomDraft(String(safeValue))
      return
    }
    const next = Math.max(1, Math.min(maxValue, parsed))
    onChange(next)
    setCustomDraft(String(next))
    setOpen(false)
  }

  const handleCustomKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      commitCustom(event.currentTarget.value)
      event.currentTarget.blur()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setCustomDraft(String(safeValue))
      setOpen(false)
    }
  }

  const buttonLabel = useMemo(() => (isPreset ? safeValue : safeValue), [isPreset, safeValue])

  return (
    <div ref={rootRef} className={`relative inline-flex min-w-0 ${className}`.trim()} data-page-size-select-root="true">
      <button
        id={id}
        type="button"
        className={`inline-flex min-w-0 items-center justify-between gap-2 rounded-[0.95rem] border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-900 dark:focus:border-blue-500 dark:focus:ring-blue-950 ${buttonClassName}`.trim()}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) return
          setOpen((current) => {
            if (!current) setTimeout(reposition, 0)
            return !current
          })
        }}
      >
        <span className="min-w-0 flex-1 truncate">{buttonLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`max-h-[min(18rem,calc(100vh-1rem))] overflow-y-auto overscroll-contain rounded-[1.05rem] border border-slate-200 bg-white p-1.5 shadow-2xl shadow-slate-900/12 ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/35 ${menuClassName}`.trim()}
          style={usePortalMenu ? { position: 'fixed', top: position.top, left: position.left, width: position.width, zIndex: 10000 } : undefined}
        >
          {options.map((option) => {
            const selected = isPreset && option === safeValue
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex w-full min-w-0 items-center rounded-[0.85rem] px-3 py-2 text-left text-sm font-semibold transition ${
                  selected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'
                } ${optionClassName}`.trim()}
                onClick={() => choosePreset(option)}
              >
                <span className="min-w-0 flex-1 truncate">{option}</span>
              </button>
            )
          })}
          {allowCustom ? (
            <div className={`mt-1 flex items-center gap-2 rounded-[0.85rem] border px-3 py-1.5 transition ${
              !isPreset
                ? 'border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/30'
                : 'border-transparent'
            }`}
            >
              <label
                htmlFor={id ? `${id}-custom` : undefined}
                className={`text-sm font-semibold ${!isPreset ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'} ${optionClassName}`.trim()}
              >
                {customLabel}
              </label>
              <input
                ref={customInputRef}
                id={id ? `${id}-custom` : undefined}
                type="text"
                inputMode="numeric"
                aria-label={`${customLabel} ${ariaLabel || ''}`.trim()}
                placeholder="#"
                className="ml-auto h-7 w-14 rounded-full border border-slate-200 bg-white px-1 text-center text-xs font-semibold text-slate-700 outline-none focus:border-blue-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                value={customDraft}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setCustomDraft(event.target.value.replace(/[^\d]/g, ''))}
                onBlur={(event) => commitCustom(event.currentTarget.value)}
                onKeyDown={handleCustomKeyDown}
              />
            </div>
          ) : null}
        </div>,
        document.body,
      )}
    </div>
  )
}
