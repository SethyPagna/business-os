import { useEffect, useState } from 'react'
import Gauge from 'lucide-react/dist/esm/icons/gauge.js'
import InfoHint from '../shared/InfoHint.tsx'
import { useIsPageActive } from '../shared/pageActivity'
import {
  fetchPlanStatus,
  formatPlanNoticeValue,
  humanizePlanLimitId,
  planNoticeLabelKey,
  type PlanStatus,
} from '../../utils/planTier.ts'

type CopyFn = (key: string, fallback: string, fallbackKm?: string) => string

// "Free degrades visibly": one compact line, at the top of the Backup
// section, whenever this deployment runs on the Cloudflare free plan.
//
// Why a line and not a panel: on the free config roughly two dozen ceilings
// are smaller than on paid, and printing all of them would be a wall of
// numbers on a page whose actual job is backups. The line states the fact
// and the count; the numbers themselves -- each one as "now (paid: N)" --
// live behind the InfoHint, which is this project's standing answer for an
// explanation that must be available without being in the way.
//
// On the paid plan it renders NOTHING. There is nothing to disclose: paid IS
// the headroom baseline, so a "you are on paid" badge would be chrome that
// tells an operator nothing they can act on.
export default function PlanTierNotice({ copy }: { copy: CopyFn }) {
  const [status, setStatus] = useState<PlanStatus | null>(null)
  // Same page id the rest of this section uses -- Backup renders under the
  // Settings hub, and a background tab must not keep polling.
  const pageActive = useIsPageActive('settings')

  useEffect(() => {
    if (!pageActive || status) return undefined
    let alive = true
    // Read once per mount, not on a timer: the tier is a deploy-time
    // constant (the Worker itself caches it per isolate), so re-reading it
    // every few seconds would spend requests to learn the same answer.
    void fetchPlanStatus().then((result) => { if (alive) setStatus(result) })
    return () => { alive = false }
  }, [pageActive, status])

  if (!status || status.tier !== 'free' || !status.notices.length) return null

  const words = {
    on: copy('plan_limit_value_on', 'on', 'បើក'),
    off: copy('plan_limit_value_off', 'off', 'បិទ'),
  }
  const lines = status.notices.map((notice) => {
    const key = planNoticeLabelKey(notice.id)
    const label = key ? copy(key, humanizePlanLimitId(notice.id)) : humanizePlanLimitId(notice.id)
    const now = formatPlanNoticeValue(notice.free, words)
    const paid = formatPlanNoticeValue(notice.paid, words)
    return `${label}: ${now} (${copy('plan_tier_paid', 'paid', 'បង់ប្រាក់')}: ${paid})`
  })
  const hint = [
    copy(
      'plan_tier_free_hint',
      'This deployment runs on the Cloudflare free plan. Each line is the ceiling in force now, then what the paid plan allows. Nothing is broken -- imports, stock files and backups just work in smaller passes.',
      'ការដំឡើងនេះដំណើរការលើគម្រោងឥតគិតថ្លៃ Cloudflare។ ជួរនីមួយៗគឺជាដែនកំណត់បច្ចុប្បន្ន បន្ទាប់មកអ្វីដែលគម្រោងបង់ប្រាក់អនុញ្ញាត។ គ្មានអ្វីខូចទេ -- ការនាំចូល ឯកសារស្តុក និងបម្រុងទុក ដំណើរការជាវគ្គតូចជាងប៉ុណ្ណោះ។',
    ),
    '',
    ...lines,
  ].join('\n')

  return (
    // Design-language tokens only (no blue utility classes), single row:
    // the summary span truncates instead of wrapping the row (P2-8 merge fix).
    <div className="flex min-w-0 items-center gap-2 rounded-[var(--ui-radius-lg)] border border-[var(--ui-line-2)] bg-[var(--ui-surface-2)] px-3 py-2 text-sm text-[var(--ui-ink)]">
      <Gauge className="h-4 w-4 shrink-0 text-[var(--ui-info)]" />
      <span className="font-semibold">{copy('plan_tier_free_title', 'Free plan', 'គម្រោងឥតគិតថ្លៃ')}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--ui-ink-2)]">
        {copy('plan_tier_free_summary', '{count} limits smaller than on paid', '{count} ដែនកំណត់តូចជាងគម្រោងបង់ប្រាក់')
          .replace('{count}', String(status.notices.length))}
      </span>
      <InfoHint
        label={copy('plan_tier_free_hint_label', 'About the free plan limits', 'អំពីដែនកំណត់គម្រោងឥតគិតថ្លៃ')}
        text={hint}
      />
    </div>
  )
}
