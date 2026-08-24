import X from 'lucide-react/dist/esm/icons/x.js'
import type { InputHTMLAttributes } from 'react'

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name' | 'value' | 'onChange' | 'className' | 'placeholder' | 'type'
>

type SearchInputProps = NativeInputProps & {
  id: string
  name?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  inputClassName?: string
  showClear?: boolean
}

/**
 * Shared search field used across admin list views (Products, Inventory, Sales,
 * Customers, Suppliers, Returns, Users, etc). Wraps the standard `.input` style
 * with an optional trailing clear button so every section shares the same
 * look, spacing, and behavior. No leading search icon -- it ate into the
 * field's usable width for no real benefit once the placeholder text (or a
 * typed query) already makes the field's purpose obvious; every page that
 * renders this gets the extra space back automatically since they all share
 * this one component.
 */
export default function SearchInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = 'min-w-0 flex-1',
  inputClassName = '',
  showClear = true,
  autoComplete = 'off',
  ...rest
}: SearchInputProps) {
  const label = ariaLabel || placeholder
  return (
    <label htmlFor={id} className={`relative ${className}`.trim()}>
      <input
        id={id}
        name={name}
        type="text"
        autoComplete={autoComplete}
        className={`input min-w-0 w-full ${showClear && value ? 'pr-8' : ''} ${inputClassName}`.trim()}
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      {showClear && value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          aria-label="Clear search"
          tabIndex={-1}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </label>
  )
}
