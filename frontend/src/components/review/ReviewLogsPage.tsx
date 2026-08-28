import { Suspense, lazy, useState } from 'react'
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js'
import ScrollText from 'lucide-react/dist/esm/icons/scroll-text.js'
import { useApp as useAppHook } from '../../AppContext.tsx'

// E3 (Part 403): Review + Audit Log merge into ONE "Review & Logs" page --
// the approvals queue and the audit trail side by side as sections. Pure
// rewiring per the Phase-E contract: both section components move intact
// (their permission keys stay 'review' / 'audit_log'; only the standalone
// audit_log PAGE id retires), and /audit-log deep links land here with the
// Audit section open.

const ReviewQueueSection = lazy(() => import('./ReviewQueue'))
const AuditLogSection = lazy(() => import('../utils-settings/AuditLog'))

type ReviewLogsAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => ReviewLogsAppContext

type ReviewLogsSection = 'review' | 'audit'

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
  const [section, setSection] = useState<ReviewLogsSection>(() => initialSection(canReview, canAudit))

  return (
    <div className="space-y-3">
      {canReview && canAudit ? (
        <div className="px-4 pt-4">
          <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
            <button
              type="button"
              onClick={() => setSection('review')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${section === 'review' ? 'bg-white dark:bg-gray-900 shadow text-blue-600' : 'text-gray-500'}`}
            >
              <ClipboardCheck className="w-4 h-4" /> {t('review_queue') || 'Review queue'}
            </button>
            <button
              type="button"
              onClick={() => setSection('audit')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 ${section === 'audit' ? 'bg-white dark:bg-gray-900 shadow text-teal-600' : 'text-gray-500'}`}
            >
              <ScrollText className="w-4 h-4" /> {t('audit_log') || 'Audit Log'}
            </button>
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{t('loading') || 'Loading'}...</p>}>
        {section === 'audit' && canAudit ? <AuditLogSection /> : canReview ? <ReviewQueueSection /> : <AuditLogSection />}
      </Suspense>
    </div>
  )
}
