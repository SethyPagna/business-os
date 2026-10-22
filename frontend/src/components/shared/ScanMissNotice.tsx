import FilterX from 'lucide-react/dist/esm/icons/filter-x.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import type { ScanMiss } from '../../utils/scanMiss.ts'

interface ScanMissNoticeProps {
  miss: ScanMiss
  t: (key: string) => string
  /** Products only, for accounts that may create products: a new product with this barcode filled in. */
  onCreate?: () => void
  /** Clears every filter but keeps the scanned code in the search, so the hidden product then shows. */
  onClearFilters?: () => void
}

/**
 * Where an empty list shows after a scan: no product has that barcode, or the filters hide it.
 * Words come from the packs (scan_no_match / scan_hidden_by_filters); each action is the page's main
 * action here, so it keeps its icon and one word, with the full sentence as its tooltip.
 */
export default function ScanMissNotice({ miss, t, onCreate, onClearFilters }: ScanMissNoticeProps) {
  const hidden = miss.kind === 'hidden_by_filters'
  const message = hidden ? t('scan_hidden_by_filters') : t('scan_no_match').replace('{code}', miss.code)
  // The shared button is at least 40px tall; the sentence gets a line box Khmer glyphs fit in.
  const buttonClass = 'btn-primary inline-flex items-center gap-1.5 text-sm'
  return (
    <div role="status" data-scan-miss={miss.kind} className="flex flex-col items-center gap-2 text-gray-600 dark:text-gray-300">
      <p className="max-w-full break-words text-sm leading-6">{message}</p>
      {hidden && onClearFilters ? (
        <button type="button" onClick={onClearFilters} className={buttonClass} title={t('clear_filters')} aria-label={t('clear_filters')}>
          <FilterX className="h-4 w-4" aria-hidden="true" />
          {t('clear')}
        </button>
      ) : null}
      {!hidden && onCreate ? (
        <button type="button" onClick={onCreate} className={buttonClass} title={t('scan_create_with_barcode')} aria-label={t('scan_create_with_barcode')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('create')}
        </button>
      ) : null}
    </div>
  )
}
