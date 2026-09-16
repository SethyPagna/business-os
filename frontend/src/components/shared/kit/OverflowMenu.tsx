import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js'
import type { ReactNode } from 'react'
import LazyPortalMenu from '../LazyPortalMenu'
import IconButton from './IconButton'

export type OverflowMenuItem = {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

export type OverflowMenuProps = {
  items: OverflowMenuItem[]
  /** Accessible label / tooltip for the "..." trigger. */
  label?: string
  align?: 'left' | 'right' | 'auto'
  className?: string
}

// OverflowMenu -- a kit-flavoured trigger over the app's EXISTING menu
// positioning primitive (`LazyPortalMenu` -> `PortalMenu`), not a new
// positioning engine. Per the brief: "uses the existing PortalMenu/
// LazyPortalMenu positioning, --z-dropdown" -- in practice PortalMenu's
// popover is a document.body portal with its own fixed `zIndex: 9999`
// (see PortalMenu.tsx), independent of any ancestor's stacking context, so
// it does not read the `--z-dropdown` CSS var itself (that token is for
// PAGE-LOCAL, non-portalled dropdowns -- see zLayers.ts's comment). This
// primitive is the kit's typed, icon-labelled adapter over that existing
// mechanism: it maps the kit's `{label, icon?, onSelect, danger?,
// disabled?}` item shape onto PortalMenu's own `{label, onClick, color,
// icon, disabled}` shape rather than asking every caller to know that
// shape (or PortalMenu's `red`/`gray` color vocabulary) directly.
export default function OverflowMenu({ items, label = 'More actions', align = 'auto', className = '' }: OverflowMenuProps) {
  return (
    <LazyPortalMenu
      trigger={<IconButton label={label} icon={<MoreHorizontal />} variant="ghost" className={className} />}
      align={align}
      items={items.map((item) => ({
        label: item.label,
        icon: item.icon,
        onClick: item.onSelect,
        disabled: item.disabled,
        color: item.danger ? 'red' : 'gray',
      }))}
    />
  )
}
