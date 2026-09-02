import FileText from 'lucide-react/dist/esm/icons/file-text.js'
import Inbox from 'lucide-react/dist/esm/icons/inbox.js'
import Moon from 'lucide-react/dist/esm/icons/moon.js'
import Package from 'lucide-react/dist/esm/icons/package.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import SettingsIcon from 'lucide-react/dist/esm/icons/settings.js'
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js'
import Sun from 'lucide-react/dist/esm/icons/sun.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import { useEffect, useRef, useState } from 'react'
import SearchInput from '../SearchInput.tsx'
import Button from './Button'
import Chip from './Chip'
import ControlRow from './ControlRow'
import DenseTable, { DenseTableExpandCell } from './DenseTable'
import EmptyState from './EmptyState'
import Fold from './Fold'
import HubTile from './HubTile'
import IconButton from './IconButton'
import OverflowMenu from './OverflowMenu'
import SectionHeader from './SectionHeader'
import Skeleton from './Skeleton'
import StatStrip, { type StatCardDef } from './StatStrip'
import TileGrid from './TileGrid'

type PreviewLang = 'en' | 'km'
type LangPack = Record<string, string>

const GALLERY_STRINGS: Record<PreviewLang, LangPack> = { en: {}, km: {} }

// KitGallery -- one page rendering every kit primitive in every variant/
// state, in both languages, with a light/dark preview toggle and a live
// viewport-tier hint. This is the visual-QA surface the user's checkpoint
// (decision 18) screenshots first; it is deliberately self-contained and
// does not depend on any page's own data. Rendering it behind the admin
// permission is the caller's job (see Settings.tsx's `isAdmin &&
// showSettingsSection('appearance')` wiring, matching every sibling
// Appearance block) -- this component does not re-check admin itself.
//
// The preview-language toggle is intentionally independent of the app's
// global Settings -> Language choice: it loads both lang packs directly
// (the same dynamic `import('../lang/en.json')` pattern AppContext.tsx
// already uses for its own lazy language-pack load) so a reviewer can flip
// language here without touching the live app setting.
export default function KitGallery() {
  const [previewLang, setPreviewLang] = useState<PreviewLang>('en')
  const [dark, setDark] = useState(false)
  const [packsReady, setPacksReady] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  const [search, setSearch] = useState('')
  const [foldOpen, setFoldOpen] = useState(false)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [buttonLoading, setButtonLoading] = useState(false)
  const foldTriggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([import('../../../lang/en.json'), import('../../../lang/km.json')])
      .then(([en, km]) => {
        if (cancelled) return
        GALLERY_STRINGS.en = en.default as LangPack
        GALLERY_STRINGS.km = km.default as LangPack
        setPacksReady(true)
      })
      .catch(() => setPacksReady(false))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const tr = (key: string, fallback: string): string => {
    const pack = GALLERY_STRINGS[previewLang]
    return pack?.[key] || fallback
  }

  const tier = viewportWidth >= 1024 ? 'wide (>=1024px)' : viewportWidth >= 768 ? 'medium (768-1023px)' : 'narrow (<768px)'

  const sampleCards: StatCardDef[] = [
    { key: 'sales', label: tr('sales', 'Sales'), value: '42', tone: 'accent' },
    { key: 'revenue', label: tr('revenue', 'Revenue'), value: '$1,204', tone: 'ok' },
    { key: 'returns', label: tr('returns', 'Returns'), value: '2', tone: 'warn' },
  ]

  const sampleRows = [
    { key: 'r1', name: 'Rose Gold Ring', sku: 'RG-001', qty: 12 },
    { key: 'r2', name: 'Silver Bracelet', sku: 'SB-014', qty: 5 },
  ]

  const tileItems = [
    { key: 'products', label: tr('products', 'Products'), icon: <Package />, onSelect: () => {}, badge: 3 },
    { key: 'sales', label: tr('sales', 'Sales'), icon: <ShoppingCart />, onSelect: () => {} },
    { key: 'contacts', label: tr('contacts', 'Contacts'), icon: <Users />, onSelect: () => {} },
    { key: 'reports', label: tr('reports', 'Reports'), icon: <FileText />, onSelect: () => {} },
    { key: 'admin_only', label: 'Admin only', icon: <SettingsIcon />, onSelect: () => {}, hidden: true },
  ]

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-w-0 bg-[var(--ui-ground)] font-[family-name:var(--ui-font-body)] text-[length:var(--ui-size-body)] text-[var(--ui-ink)]">
        <div className="flex flex-col gap-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ui-line)] pb-3">
            <div>
              <h1 className="font-[family-name:var(--ui-font-display)] text-[length:var(--ui-size-h1)] font-semibold">
                {tr('kit_gallery_title', 'Design kit')}
              </h1>
              <p className="text-[length:var(--ui-size-meta)] text-[var(--ui-ink-2)]">
                {tr('kit_gallery_subtitle', 'Every kit primitive, both languages, light and dark.')}
                {' '}{tr('kit_gallery_viewport', 'Viewport tier:')} {tier} ({viewportWidth}px)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Chip selected={previewLang === 'en'} onClick={() => setPreviewLang('en')}>{tr('english', 'English')}</Chip>
              <Chip selected={previewLang === 'km'} onClick={() => setPreviewLang('km')}>{tr('khmer', 'Khmer')}</Chip>
              <IconButton
                label={dark ? tr('light', 'Light') : tr('dark', 'Dark')}
                icon={dark ? <Sun /> : <Moon />}
                variant="secondary"
                onClick={() => setDark((v) => !v)}
              />
            </div>
          </div>

          {!packsReady ? <Skeleton rows={2} variant="text" /> : null}

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_buttons', 'Buttons')} />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">{tr('actions', 'Actions')}</Button>
              <Button variant="secondary">{tr('edit', 'Edit')}</Button>
              <Button variant="ghost">{tr('details', 'Details')}</Button>
              <Button variant="danger" icon={<Trash2 />}>{tr('delete', 'Delete')}</Button>
              <Button variant="primary" size="sm" icon={<Plus />}>{tr('actions', 'Actions')}</Button>
              <Button variant="primary" loading={buttonLoading} onClick={() => { setButtonLoading(true); setTimeout(() => setButtonLoading(false), 1200) }}>
                {tr('loading', 'Loading...')}
              </Button>
              <Button variant="primary" disabled>{tr('actions', 'Actions')}</Button>
              <IconButton label={tr('delete', 'Delete')} icon={<Trash2 />} variant="danger" />
              <IconButton label={tr('edit', 'Edit')} icon={<SettingsIcon />} variant="ghost" />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_chips', 'Chips')} count={3} />
            <div className="flex flex-wrap items-center gap-2">
              <Chip selected>{tr('products', 'Products')}</Chip>
              <Chip>{tr('sales', 'Sales')}</Chip>
              <Chip count={5}>{tr('contacts', 'Contacts')}</Chip>
              <Chip onRemove={() => {}}>{tr('preview', 'Preview')}</Chip>
              <Chip disabled>{tr('reports', 'Reports')}</Chip>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader
              title={tr('kit_gallery_section_control_row', 'Control row')}
              count={sampleRows.length}
              actions={<OverflowMenu items={[
                { label: tr('edit', 'Edit'), onSelect: () => {} },
                { label: tr('delete', 'Delete'), onSelect: () => {}, danger: true },
              ]} />}
            />
            {/* filters/range use lightweight stand-ins sized like the real
                DateTimeRangePicker/FilterMenu controls rather than fully
                wiring those data-heavy components, which need live
                facet/date state a static gallery page doesn't have --
                ControlRow treats these as opaque ReactNode slots either
                way, so this doesn't change what the gallery demonstrates
                (the row's own responsive tier-collapsing behaviour). */}
            <ControlRow
              search={<SearchInput id="kit-gallery-search" value={search} onChange={setSearch} placeholder={tr('search', 'Search')} />}
              range={<Button variant="secondary" size="sm">{tr('kit_gallery_sample_range', 'This week')}</Button>}
              filters={<Button variant="secondary" size="sm">{tr('kit_gallery_sample_filters', 'Filters')}</Button>}
              actions={<Button variant="primary" size="sm" icon={<Plus />}>{tr('actions', 'Actions')}</Button>}
            />
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_stat_strip', 'Stat strip')} />
            <StatStrip cards={sampleCards} t={(key) => tr(key, key)} />
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader
              title={tr('kit_gallery_section_fold', 'Fold')}
              actions={<Button ref={foldTriggerRef} variant="secondary" size="sm" onClick={() => setFoldOpen(true)}>{tr('kit_gallery_open_fold', 'Open fold')}</Button>}
            />
            <Fold open={foldOpen} onClose={() => setFoldOpen(false)} title={tr('details', 'Details')} anchorRef={foldTriggerRef}>
              <p className="text-[length:var(--ui-size-meta)] text-[var(--ui-ink-2)]">
                {tr('kit_gallery_fold_body', 'Floating panel on desktop, bottom sheet on mobile.')}
              </p>
            </Fold>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_dense_table', 'Dense table')} />
            <DenseTable>
              <thead>
                <tr>
                  <th></th>
                  <th>{tr('products', 'Products')}</th>
                  <th>SKU</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {sampleRows.map((row) => (
                  <tr key={row.key}>
                    <DenseTableExpandCell rowKey={row.key} expandRow={(key) => setExpandedRow((v) => (v === key ? null : key))} open={expandedRow === row.key} />
                    <td>{row.name}</td>
                    <td>{row.sku}</td>
                    <td>{row.qty}</td>
                  </tr>
                ))}
              </tbody>
            </DenseTable>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_empty_state', 'Empty state')} />
            <div className="rounded-[var(--ui-radius)] border border-[var(--ui-line)]">
              <EmptyState
                icon={<Inbox />}
                title={tr('kit_gallery_sample_empty_title', 'Nothing here yet')}
                text={tr('kit_gallery_sample_empty_text', 'Try a different filter or date range.')}
                action={<Button variant="secondary" size="sm">{tr('actions', 'Actions')}</Button>}
              />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_skeleton', 'Skeleton')} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Skeleton variant="table" rows={3} />
              <Skeleton variant="cards" rows={4} />
              <Skeleton variant="text" rows={3} />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <SectionHeader title={tr('kit_gallery_section_tile_grid', 'Tile grid (mobile home)')} />
            <TileGrid items={tileItems} />
          </section>
        </div>
      </div>
    </div>
  )
}
