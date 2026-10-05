import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Ban from 'lucide-react/dist/esm/icons/ban.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import type { ReturnStockAction } from './helpers/returnOptions.ts'

const ICONS = { restock: Undo2, damaged: AlertTriangle, none: Ban } as const

/** The icon for what a return does to one line's stock (restock / damaged / none). */
export default function StockActionIcon({ action, className = 'h-3 w-3' }: { action: ReturnStockAction; className?: string }) {
  const Icon = ICONS[action] ?? Ban
  return <Icon className={`inline-block shrink-0 ${className}`} aria-hidden="true" />
}
