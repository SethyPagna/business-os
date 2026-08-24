import { forwardRef } from 'react'
import type { LucideProps } from 'lucide-react'

/**
 * Stylized Facebook Messenger glyph -- the rounded speech-bubble-with-tail
 * shape and internal "lightning bolt" chevron that reads as Messenger at a
 * glance, drawn in this app's own line-icon style (24x24, stroke=currentColor)
 * rather than lucide's generic MessageSquare, which was previously used as a
 * stand-in and doesn't read as Messenger to anyone who recognizes the app.
 *
 * Built as a LucideProps-typed forwardRef component so it's a drop-in
 * replacement anywhere a `LucideIcon` is expected (icon maps typed
 * `Record<string, LucideIcon>`, `<Icon className="..." />` call sites, etc.).
 */
export const MessengerIcon = forwardRef<SVGSVGElement, LucideProps>(function MessengerIcon(
  { color = 'currentColor', size = 24, strokeWidth = 2, className, ...rest },
  ref,
) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      <path d="M12 3C7.03 3 3 6.69 3 11.25c0 2.7 1.42 5.1 3.62 6.62.19.13.3.35.3.58l.06 2.02c.02.66.7 1.09 1.3.8l2.26-1.1c.19-.09.4-.11.61-.06.6.14 1.22.22 1.85.22 4.97 0 9-3.69 9-8.25S16.97 3 12 3Z" />
      <path
        d="m8 13.3 3.4-3.7a.6.6 0 0 1 .86-.03L15 12.1l3-3.3-3.55 5.8-2.6-2.53a.6.6 0 0 0-.85.03L8 15.4z"
        fill={color}
        stroke="none"
      />
    </svg>
  )
})
