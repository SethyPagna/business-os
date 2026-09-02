import { Suspense, lazy, useState } from 'react'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import ScrollText from 'lucide-react/dist/esm/icons/scroll-text.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import { useApp as useAppHook } from '../../AppContext.tsx'

// E3 (Part 403): Review + Audit Log merge into ONE "Review & Logs" page --
// the approvals queue and the audit trail side by side as sections. Pure
// rewiring per the Phase-E contract: both section components move intact
// (their permission keys stay 'review' / 'audit_log'; only the standalone
// audit_log PAGE id retires), and /audit-log deep links land here with the
// Audit section open.
//
// Part 551 adds the third section: the legacy deleted-sale ledger (the old
// system's deleted cart/bill lines, imported Aug 30 as audit evidence).
// It is an audit trail, so it shares the audit_log permission.

const ReviewQueueSection = lazy(() => import('./ReviewQueue'))
const AuditLogSection = lazy(() => import('../utils-settings/AuditLog'))
const LegacyDeletedSalesSection = lazy(() => import('./LegacyDeletedSalesSection'))

type ReviewLogsAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => ReviewLogsAppContext

type ReviewLogsSection = 'review' | 'audit' | 'deleted'

function initialSection(canReview: boolean, canAudit: boolean): ReviewLogsSection {
  // Deep link: the old standalone URLs keep meaning what they said.
  if (typeof window !== 'undefined') {
    const segment = String(window.location.pathname || '').toLowerCase()
    if ((segment.includes('audit')) && canAudit) return 'audit'
  }
  return canReview ? 'review' : 'audit'
}

export default function ReviewLogsPage() {
  const { t, getPermissionTier } = useApp()
  const canReview = getPermissionTier('review') !== 'none'
  const canAudit = getPermissionTier('audit_log') !== 'none'
  // audit_log view tier (Part 557 slice 7): 'view' sees the main Audit Log
  // scoped to their OWN actions; the legacy deleted-sale ledger is a
  // cross-user evidence view whose endpoint stays Full-only (denyUnless), so
  // that chip/section shows only for 'full'.
  const canAuditAll = getPermissionTier('audit_log') === 'full'
  const [section, setSection] = useState<ReviewLogsSection>(() => initialSection(canReview, canAudit))

  const chips: Array<{ key: ReviewLogsSection; label: string; icon: typeof ClipboardCheck; activeColor: string }> = [
    ...(canReview ? [{ key: 'review' as const, label: t('review_queue') || 'Review queue', icon: ClipboardCheck, activeColor: 'text-blue-600' }] : []),
    ...(canAudit ? [
      { key: 'audit' as const, label: t('audit_log') || 'Audit Log', icon: ScrollText, activeColor: 'text-teal-600' },
    ] : []),
    ...(canAuditAll ? [
      { key: 'deleted' as const, label: t('legacy_deleted_sales') || 'Deleted sales (old system)', icon: Trash2, activeColor: 'text-rose-600' },
    ] : []),
  ]

  return (
    // Height-filling flex column so the hosted sections' `page-scroll`
    // roots get a bounded height and actually scroll (Y4 regression).
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      {chips.length > 1 ? (
        <div className="min-w-0 shrink-0 px-4 pt-4">
          <div className="inline-flex max-w-full overflow-x-auto overscroll-x-contain rounded-xl bg-gray-100 p-0.5 [touch-action:pan-x] dark:bg-gray-800">
            {chips.map((chip) => {
              const Icon = chip.icon
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setSection(chip.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${section === chip.key ? `bg-white dark:bg-gray-900 shadow ${chip.activeColor}` : 'text-gray-500'}`}
                >
                  <Icon className="w-4 h-4" /> {chip.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{t('loading') || 'Loading'}...</p>}>
        {section === 'deleted' && canAuditAll ? (
          <LegacyDeletedSalesSection />
        ) : section === 'audit' && canAudit ? (
          <AuditLogSection />
        ) : canReview ? (
          <ReviewQueueSection />
        ) : (
          <AuditLogSection />
        )}
      </Suspense>
    </div>
  )
}
