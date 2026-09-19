import type { LucideIcon } from 'lucide-react'
import ArchiveRestore from 'lucide-react/dist/esm/icons/archive-restore.js'
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js'
import Bike from 'lucide-react/dist/esm/icons/bike.js'
import Boxes from 'lucide-react/dist/esm/icons/boxes.js'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import Copy from 'lucide-react/dist/esm/icons/copy.js'
import Factory from 'lucide-react/dist/esm/icons/factory.js'
import Gauge from 'lucide-react/dist/esm/icons/gauge.js'
import Gift from 'lucide-react/dist/esm/icons/gift.js'
import HardDriveDownload from 'lucide-react/dist/esm/icons/hard-drive-download.js'
import History from 'lucide-react/dist/esm/icons/history.js'
import ListChecks from 'lucide-react/dist/esm/icons/list-checks.js'
import PackagePlus from 'lucide-react/dist/esm/icons/package-plus.js'
import PackageSearch from 'lucide-react/dist/esm/icons/package-search.js'
import RadioTower from 'lucide-react/dist/esm/icons/radio-tower.js'
import ReceiptText from 'lucide-react/dist/esm/icons/receipt-text.js'
import ScrollText from 'lucide-react/dist/esm/icons/scroll-text.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import UserCog from 'lucide-react/dist/esm/icons/user-cog.js'
import UserRound from 'lucide-react/dist/esm/icons/user-round.js'
import WalletCards from 'lucide-react/dist/esm/icons/wallet-cards.js'

const ICONS_BY_SECTION: Record<string, LucideIcon> = {
  'branches:overview': Gauge,
  'branches:products': PackageSearch,
  'branches:transfers': ArrowLeftRight,
  'branches:rfid': RadioTower,
  'sales:sales': ReceiptText,
  'sales:returns': Undo2,
  'sales:fees': WalletCards,
  'sales:reports': BarChart3,
  'contacts:customers': UserRound,
  'contacts:suppliers': Factory,
  'contacts:delivery': Bike,
  'contacts:duplicates': Copy,
  'promotions:rules': ListChecks,
  'promotions:discounts': BadgePercent,
  'promotions:loyalty': Gift,
  'settings:settings': SlidersHorizontal,
  'settings:users': UserCog,
  'settings:backup': HardDriveDownload,
  'products:products': Boxes,
  'products:stock_changes': History,
  'products:stock_in_sessions': PackagePlus,
  'products:duplicates': Copy,
  'review:review': ClipboardCheck,
  'review:audit': ScrollText,
  'review:deleted': ArchiveRestore,
}

/** Every permission-filtered hub destination has a stable, local visual cue. */
export function getMobileSectionIcon(ownerId: string, sectionId: string): LucideIcon | null {
  return ICONS_BY_SECTION[`${ownerId}:${sectionId}`] || null
}
