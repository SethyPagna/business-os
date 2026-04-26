// ── NoData ────────────────────────────────────────────────────────────────────
// Shared empty-state placeholder rendered by all chart components when the
// data array is empty or undefined.

import { useApp } from '../../../AppContext'

export default function NoData() {
  const { t } = useApp()
  return (
    <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
      {t('no_data_for_period')||'No data for this period'}
    </div>
  )
}
