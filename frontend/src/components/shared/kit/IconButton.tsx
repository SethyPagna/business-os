import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { ButtonVariant } from './Button'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** Required -- becomes both the accessible name (`aria-label`) and the
   *  hover tooltip (`title`) for an icon-only control. */
  label: string
  icon: ReactNode
  variant?: ButtonVariant
  loading?: boolean
  className?: string
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--ui-accent)] text-[var(--ui-ground)] border border-transparent hover:not-disabled:brightness-[.94] active:not-disabled:brightness-[.88]',
  secondary: 'bg-[var(--ui-surface)] text-[var(--ui-ink)] border border-[var(--ui-line-2)] hover:not-disabled:bg-[var(--ui-surface-2)]',
  ghost: 'bg-transparent text-[var(--ui-ink-2)] border border-transparent hover:not-disabled:bg-[var(--ui-surface-2)] hover:not-disabled:text-[var(--ui-ink)]',
  danger: 'bg-[var(--ui-danger)] text-[var(--ui-ground)] border border-transparent hover:not-disabled:brightness-[.92]',
}

// IconButton -- a Button with no visible label. `label` is mandatory (not
// optional the way `title`/`aria-label` are on a bare <button>) so an
// icon-only control can never ship without an accessible name -- the kit's
// one enforced a11y guarantee for this shape.
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', loading = false, disabled, className, type = 'button', ...rest },
  ref
) {
  const isDisabled = disabled || loading
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      className={[
        'inline-flex shrink-0 items-center justify-center rounded-[var(--ui-radius)]',
        'h-[var(--ui-control-h)] w-[var(--ui-control-h)]',
        'transition-[filter,background-color,border-color] duration-150',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:shadow-[var(--ui-focus)]',
        VARIANT_CLASS[variant],
        className || '',
      ].join(' ').trim()}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">{icon}</span>
      )}
    </button>
  )
})

export default IconButton
