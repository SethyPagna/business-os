import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** primary = gold fill/ivory text; secondary = surface + hairline; ghost = no
   *  border; danger = danger fill. Hover darkens via `filter: brightness()`
   *  (never a hard-coded blue). */
  variant?: ButtonVariant
  /** Both sizes share `--ui-control-h` (32px desktop / 40px mobile) so they
   *  line up in a `ControlRow`; `sm` is a tighter horizontal density for
   *  dense toolbars. */
  size?: ButtonSize
  /** Leading icon -- rendered at the kit's one "in-control" icon size
   *  (16px), regardless of `size`. */
  icon?: ReactNode
  /** Swaps the icon (or adds one) for a spinner and disables the button. */
  loading?: boolean
  children?: ReactNode
  className?: string
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-[var(--ui-accent)] text-[var(--ui-ground)] border border-transparent hover:not-disabled:brightness-[.94] active:not-disabled:brightness-[.88]',
  secondary: 'bg-[var(--ui-surface)] text-[var(--ui-ink)] border border-[var(--ui-line-2)] hover:not-disabled:bg-[var(--ui-surface-2)]',
  ghost: 'bg-transparent text-[var(--ui-ink)] border border-transparent hover:not-disabled:bg-[var(--ui-surface-2)]',
  danger: 'bg-[var(--ui-danger)] text-[var(--ui-ground)] border border-transparent hover:not-disabled:brightness-[.92]',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-2 gap-1 text-[12px]',
  md: 'px-3 gap-1.5 text-[13px]',
}

// Button -- the one clickable-action primitive every kit-adopting page
// reaches for (decision 4/5: no page hand-rolls its own button color).
// Deliberately thin: a single fixed opacity rule for disabled (per the
// design spec, "one opacity rule"), a focus ring token, and four variant
// classes built from tokens.css custom properties -- no new dependency, no
// per-page color decision left to make.
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, loading = false, disabled, children, className, type = 'button', ...rest },
  ref
) {
  const isDisabled = disabled || loading
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center rounded-[var(--ui-radius)] font-medium leading-none',
        'transition-[filter,background-color,border-color] duration-150',
        'h-[var(--ui-control-h)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:shadow-[var(--ui-focus)]',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className || '',
      ].join(' ').trim()}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : icon ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">{icon}</span>
      ) : null}
      {children ? <span className="truncate">{children}</span> : null}
    </button>
  )
})

export default Button
