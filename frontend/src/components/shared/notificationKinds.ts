// One icon and one short name per notification kind (NOTIF-V2: "icon by kind"). The icon says WHAT the
// row is about at a glance; the tone (red / amber / sky / green) still says how urgent it is, so the
// bubble keeps its tone colour and only the glyph inside changed from a generic severity mark.
import type { LucideIcon } from 'lucide-react'
import Award from 'lucide-react/dist/esm/icons/award.js'
import Banknote from 'lucide-react/dist/esm/icons/banknote.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import CalendarX from 'lucide-react/dist/esm/icons/calendar-x.js'
import CloudOff from 'lucide-react/dist/esm/icons/cloud-off.js'
import FileUp from 'lucide-react/dist/esm/icons/file-up.js'
import FileWarning from 'lucide-react/dist/esm/icons/file-warning.js'
import Gift from 'lucide-react/dist/esm/icons/gift.js'
import PackageMinus from 'lucide-react/dist/esm/icons/package-minus.js'
import PackageX from 'lucide-react/dist/esm/icons/package-x.js'
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js'
import Truck from 'lucide-react/dist/esm/icons/truck.js'
import Wallet from 'lucide-react/dist/esm/icons/wallet.js'

export const NOTIFICATION_KIND_ICON: Record<string, LucideIcon> = {
  inventory_out_of_stock: PackageX,
  inventory_low_stock: PackageMinus,
  sales_awaiting_payment: Wallet,
  sales_awaiting_delivery: Truck,
  product_expired: CalendarX,
  product_expiring: CalendarClock,
  supplier_credit_overdue: Banknote,
  supplier_credit_due: Banknote,
  loyalty_points_balance: Award,
  portal_pending_review: Gift,
  import_warnings: FileWarning,
  import_job: FileUp,
  system_drive_sync_connect: CloudOff,
  system_drive_sync_disabled: CloudOff,
  security_device_new_country: ShieldAlert,
  security_device_pending: ShieldAlert,
}

/** [language-pack key, English fallback, Khmer fallback] -- the kind's short name, used on a folded group. */
export type KindLabel = [key: string, en: string, km: string]

export const NOTIFICATION_KIND_LABEL: Record<string, KindLabel> = {
  inventory_out_of_stock: ['out_of_stock', 'Out of Stock', 'អស់ស្តុក'],
  inventory_low_stock: ['low_stock', 'Low Stock', 'ស្តុកទាប'],
  product_expired: ['expired', 'Expired', 'ផុតកំណត់'],
  product_expiring: ['expiring_soon', 'Expiring soon', 'ជិតផុតកំណត់'],
  supplier_credit_overdue: ['notification_kind_credit_overdue', 'Not Yet Paid · overdue', 'មិនទាន់បង់ · ហួសកំណត់'],
  supplier_credit_due: ['notification_kind_credit_due', 'Not Yet Paid · due soon', 'មិនទាន់បង់ · ជិតដល់កំណត់'],
  loyalty_points_balance: ['loyalty_points', 'Loyalty Points', 'ពិន្ទុស្មោះត្រង់'],
  portal_pending_review: ['sharePending', 'Pending review', 'កំពុងរង់ចាំពិនិត្យ'],
  import_warnings: ['imports', 'Imports', 'ការនាំចូល'],
  import_job: ['imports', 'Imports', 'ការនាំចូល'],
  system_drive_sync_connect: ['backup', 'Backup', 'ការបម្រុងទុក'],
  system_drive_sync_disabled: ['backup', 'Backup', 'ការបម្រុងទុក'],
  security_device_new_country: ['security', 'Security', 'សុវត្ថិភាព'],
  security_device_pending: ['security', 'Security', 'សុវត្ថិភាព'],
}
