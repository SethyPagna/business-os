import type { ReactNode } from 'react'
import HubTile from './HubTile'

export type TileGridItem = {
  key: string
  label: string
  icon: ReactNode
  onSelect: () => void
  badge?: number
  /** See `HubTile`'s `hidden` prop -- a permission gate, never a disable. */
  hidden?: boolean
}

export type TileGridProps = {
  items: TileGridItem[]
  /** Column count. Two columns is the design target (<768px, decision 19);
   *  desktop callers may opt into 3 or 4. */
  columns?: 2 | 3 | 4
  className?: string
}

const COLUMNS_CLASS: Record<2 | 3 | 4, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
}

// TileGrid -- lays out `HubTile`s in a fixed-gap grid. Pure structure: it
// holds no navigation/permission logic of its own beyond forwarding each
// item's own `hidden` flag to its tile, per decision 19 (mobile layer-1
// home). Desktop reuse at 3-4 columns is supported but the primitive is
// designed and gap/size-tuned for the <768px two-column case.
export default function TileGrid({ items, columns = 2, className = '' }: TileGridProps) {
  return (
    <div className={['grid gap-3', COLUMNS_CLASS[columns], className].join(' ').trim()}>
      {items.map((item) => (
        <HubTile
          key={item.key}
          label={item.label}
          icon={item.icon}
          onSelect={item.onSelect}
          badge={item.badge}
          hidden={item.hidden}
        />
      ))}
    </div>
  )
}
