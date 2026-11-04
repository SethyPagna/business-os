import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from 'react'

// The Website Editor's icon-only control (button policy: every control but the main action is an icon with a translated
// tooltip). One string is the accessible name AND the tooltip, so what a pointer sees on hover and what a screen reader
// says can never drift apart; there is no text child. `badge` is a small marker drawn beside the icon (a dirty dot).
type EditorIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'children'> & {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  badge?: ReactNode
}

const EditorIconButton = forwardRef<HTMLButtonElement, EditorIconButtonProps>(function EditorIconButton(
  { icon: Icon, label, badge = null, type = 'button', className = '', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={className} {...rest}>
      <Icon className="h-5 w-5 shrink-0" aria-hidden />
      {badge}
    </button>
  )
})

export default EditorIconButton
