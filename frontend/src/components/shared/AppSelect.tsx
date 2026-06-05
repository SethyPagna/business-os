import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'

export type AppSelectOption = {
  value: string | number
  label: ReactNode
  disabled?: boolean
}

type AppSelectProps = {
  id?: string
  name?: string
  value: string | number
  options: AppSelectOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  className?: string
  buttonClassName?: string
  menuClassName?: string
  optionClassName?: string
  disabled?: boolean
}

function optionValue(value: string | number): string {
  return String(value)
}

export default function AppSelect({
  id,
  name,
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  buttonClassName = '',
  menuClassName = '',
  optionClassName = '',
  disabled = false,
}: AppSelectProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 160 })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef(0)
  const selectedValue = optionValue(value)
  const selectedIndex = Math.max(0, options.findIndex((option) => optionValue(option.value) === selectedValue))
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  const selectedOption = useMemo(
    () => options.find((option) => optionValue(option.value) === selectedValue) || options[0],
    [options, selectedValue],
  )

  const reposition = useCallback(() => {
    const root = rootRef.current
    if (!root || !document.body.contains(root)) {
      setOpen(false)
      return
    }
    const rect = root.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight || Math.min(260, 40 * Math.max(1, options.length))
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    let top = rect.bottom + 4
    if (top + menuHeight > viewportHeight - 8) top = Math.max(8, rect.top - menuHeight - 4)
    const width = Math.max(rect.width, 96)
    const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8))
    setPosition({ top, left, width })
  }, [options.length])

  useEffect(() => {
    setActiveIndex(selectedIndex)
  }, [selectedIndex])

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

  const chooseOption = (option: AppSelectOption | undefined) => {
    if (!option || option.disabled) return
    onChange(optionValue(option.value))
    setOpen(false)
  }

  const moveActive = (direction: 1 | -1) => {
    if (!options.length) return
    let next = activeIndex
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length
      if (!options[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setTimeout(reposition, 0)
      } else {
        moveActive(1)
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        setTimeout(reposition, 0)
      } else {
        moveActive(-1)
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) chooseOption(options[activeIndex])
      else {
        setOpen(true)
        setTimeout(reposition, 0)
      }
    }
  }

  return (
    <div ref={rootRef} className={`relative inline-flex min-w-0 ${className}`.trim()}>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        id={id}
        type="button"
        className={`inline-flex min-w-0 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:bg-slate-50 focus:border-blue-300 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 dark:focus:border-blue-500 dark:focus:ring-blue-950 ${buttonClassName}`.trim()}
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
        onKeyDown={handleKeyDown}
      >
        <span className="min-w-0 flex-1 truncate">{selectedOption?.label ?? selectedValue}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className={`max-h-72 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-2xl shadow-slate-900/12 ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/35 ${menuClassName}`.trim()}
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width, zIndex: 10000 }}
        >
          {options.map((option, index) => {
            const optionStringValue = optionValue(option.value)
            const selected = optionStringValue === selectedValue
            const active = index === activeIndex
            return (
              <button
                key={optionStringValue}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                className={`flex w-full min-w-0 items-center rounded-xl px-3 py-2 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  selected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : active
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'
                } ${optionClassName}`.trim()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => chooseOption(option)}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
