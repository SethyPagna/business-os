import HubSectionNav from '../shared/HubSectionNav.tsx'
import { getHubDestinations, useHubSection } from '../shared/hubNavigation.ts'
import { Suspense, lazy } from 'react'
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
  navigateTo: (pageId: string, anchor?: string) => void
  hasPermission: (key: string) => boolean
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
  const { t, getPermissionTier, hasPermission, navigateTo } = useApp()
  const canReview = getPermissionTier('review') !== 'none'
  const canAudit = getPermissionTier('audit_log') !== 'none'
  // audit_log view tier (Part 557 slice 7): 'view' sees the main Audit Log
  // scoped to their OWN actions; the legacy deleted-sale ledger is a
  // cross-user evidence view whose endpoint stays Full-only (denyUnless), so
  // that chip/section shows only for 'full'.
  const canAuditAll = getPermissionTier('audit_log') === 'full'
  const [section, setSection] = useHubSection<ReviewLogsSection>('review', () => initialSection(canReview, canAudit), getHubDestinations('review', { getPermissionTier, hasPermission }).map((item) => item.id), navigateTo)

  // No per-chip active hue, and no forked desktop row. Review used to
  // paint its open chip blue / teal / rose while every other hub picked its
  // own hues, so "this is the section you are in" was announced in a
  // different colour on every page -- and the fork meant md+ Review never
  // reached the restyled shared row at all. The shared row states it once,
  // in the chrome's accent, and wraps rather than scrolling sideways, so the
  // long "Deleted sales (old system)" label needs no row of its own.
  const chips: Array<{ key: ReviewLogsSection; label: string; icon: typeof ClipboardCheck }> = [
    ...(canReview ? [{ key: 'review' as const, label: t('review_queue') || 'Review queue', icon: ClipboardCheck }] : []),
    ...(canAudit ? [
      { key: 'audit' as const, label: t('audit_log') || 'Audit Log', icon: ScrollText },
    ] : []),
    ...(canAuditAll ? [
      { key: 'deleted' as const, label: t('legacy_deleted_sales') || 'Deleted sales (old system)', icon: Trash2 },
    ] : []),
  ]

  return (
    // Height-filling flex column so the hosted sections' `page-scroll`
    // roots get a bounded height and actually scroll (Y4 regression).
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      <HubSectionNav
        pageId="review"
        sections={chips.map((chip) => ({ id: chip.key, label: chip.label, icon: chip.icon }))}
        active={section}
        onChange={(id) => setSection(id as ReviewLogsSection)}
      >
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
      </HubSectionNav>
    </div>
  )
}
