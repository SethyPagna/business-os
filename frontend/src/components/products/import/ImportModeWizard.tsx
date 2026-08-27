// Front door for the products bulk-import modal.
//
// Redesigned to a single screen with a 3-way mode switcher (was: 2 steps,
// General/Replace only, "Add & Link to Sales" buried as a third General
// sub-option) -- per the user's explicit ask this session: "two main
// Mode: general and replace... the other Add-Sale... click any of them
// will bring you to information toolkit, template, upload all in one...
// general and replace at the top sections to click to switch the mini
// mode... add-sale is similar, when click on this mode, bring to
// varieties of available and selectable options, and each select/
// unselect will update the information, template, upload accordingly."
//
// Concretely:
// - A 3-tab mode switcher (General / Replace / Add-Sale) always visible
//   at the top -- this is the "mini mode" switch. Replace is styled
//   distinctly (red/dangerous) since it overwrites existing data.
// - General and Replace modes: picking the mode shows that mode's
//   sub-option cards, and the info-toolkit + template + upload area
//   updates live in the same section below -- no separate "next step" to
//   reach the template, no page break between choosing and seeing it.
// - Add-Sale is its own top-level mode, and covers MORE than sales: one
//   file creates/updates products, moves stock, AND records sales. Its
//   copy says so, because "Add-Sale" alone reads as sales-only and people
//   were hunting elsewhere for the add-product/add-stock import.
//   Its options are two questions rather than five checkboxes:
//     * how rows relate -- each row alone / grouped into one sale by a
//       sale label / linked by day. `date` is a required base column
//       because it is what lets the importer order a stock arrival before
//       a sale of the same product on the same day.
//     * where cost price comes from -- in the file, or decided at review.
//   Customer, discount and fee are NOT separate toggles any more. They
//   come with whichever sale-linking mode is chosen and may be left
//   blank, because they describe one ordinary transaction (a customer
//   bought something, possibly with a discount and a delivery fee) and
//   making someone tick three more boxes to say so was busywork.
// - Every option's explanation lives behind an InfoHint (hover or tap)
//   rather than printed under its card, so a list of modes reads as a
//   list of choices instead of a wall of text.
// - One screen, one Continue/Upload action -- the old 2-step
//   choose -> template flow (and its StepDots) is gone; everything that
//   used to be step 2 (info toolkit card, template columns, "not built
//   yet" banner) now lives directly under whichever mode/option is
//   currently selected.
//
// Still deliberately a SEPARATE wrapper component, not a rewrite of
// BulkImportModal.tsx (3000+ lines, a lot of already-shipped,
// already-tested behavior this change must not regress). Once a
// fully-built path is selected (General -> Add/Update Products,
// General -> Dated Stock Reconciliation, or top-level Add-Sale), this
// wizard hands off to the real modal for that path completely
// unchanged -- same props, same component. Add-Sale now has that real
// modal (AddSaleImportModal) wired in the same way. The three Replace
// sub-behaviors still have no backend yet, so Replace mode is presented
// for real (genuinely selectable, shows its own real template/info-
// toolkit copy) but its upload action stays replaced with a clearly-
// labeled "not built yet" banner instead of pretending to import --
// this project's own standing rule against faking functionality that
// isn't actually wired up.
import { useState } from 'react'
import Download from 'lucide-react/dist/esm/icons/download.js'
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet.js'
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import InfoHint from '../../shared/InfoHint'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Columns3 from 'lucide-react/dist/esm/icons/columns-3.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import Link2 from 'lucide-react/dist/esm/icons/link.js'
import Coins from 'lucide-react/dist/esm/icons/coins.js'
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import Modal from '../../shared/Modal'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { Suspense } from 'react'

const BulkImportModal = lazyRetry(() => import('./BulkImportModal'), 'products-bulk-import-legacy')
const DatedStockReconciliationModal = lazyRetry(() => import('./DatedStockReconciliationModal'), 'products-dated-stock-reconciliation-import')
// Add-Sale now runs the server-backed unified stock-action import (§12/§13):
// one sheet does create/add/sale/reconciliation through the atomic,
// idempotent, oversell-proof engine, with a two-screen upload -> review-and-
// confirm flow. Supersedes the old client-side AddSaleImportModal.
const StockActionImportModal = lazyRetry(() => import('./StockActionImportModal'), 'products-stock-action-import')

type TopMode = 'general' | 'replace' | 'add_sale'
type GeneralSubOption = 'add_update' | 'dated_reconciliation'
type ReplaceSubOption = 'columns' | 'full_match' | 'full_wipe'

type TranslateFn = (key: string, fallback?: string, km?: string) => string

interface ImportModeWizardProps {
  onClose: () => void
  onDone: () => void
  t: TranslateFn
  // Only needed by the Dated Stock Reconciliation sub-option's review
  // screen, to show a human-readable product name next to each candidate
  // id /resolve returns -- optional so this wizard's existing callers (and
  // its own typecheck) don't need to change if they never pass it.
  products?: { id?: string | number; name?: string | null }[]
  // Only needed by the Add-Sale sub-option, to map each row's branch
  // column to a real branch id -- same optional-prop convention as
  // `products` above, for the same reason. `id` (unlike `products`
  // above) is required, matching AddSaleImportModal's own BranchOption
  // type -- every real branch record always has one.
  branches?: { id: string | number; name?: string | null }[]
}

// lucide icons are components -- typed loosely here since this file only
// ever passes the handful imported above.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComponentTypeIcon = any

interface OptionDef {
  id: GeneralSubOption | ReplaceSubOption
  icon: ComponentTypeIcon
  label: string
  description: string
  built: boolean
  templateTitle: string
  /**
   * Chips shown to the reader. These are allowed to be descriptive rather
   * than literal ("name or sku or barcode (to match)", a trailing "...")
   * because their job is to convey shape at a glance.
   */
  templateColumns: string[]
  templateNote: string
  /**
   * The REAL header row written into the downloaded file. Kept separate
   * from templateColumns on purpose: downloading a file whose header said
   * "..." would produce a template nobody can fill in.
   */
  templateHeaders: string[]
  templateFilename: string
  /** How the importer reads the file -- matching rules, blanks, defaults. */
  howItReads: string[]
  /** Rules for filling the template in before uploading it. */
  guidelines: string[]
}

const GENERAL_OPTIONS: OptionDef[] = [
  {
    id: 'add_update',
    icon: Layers,
    label: 'Add / Update Products',
    description: "Today's import: create new products or update existing ones by name/SKU/barcode match, with per-branch stock.",
    built: true,
    templateTitle: 'Add / Update Products template',
    templateColumns: ['name', 'sku', 'barcode', 'category', 'brand', 'cost_price', 'selling_price', 'branch', 'stock_quantity', 'date (received)', '...'],
    templateNote: 'This is the existing products import -- nothing about it changes. Continuing takes you into the normal upload/review flow.',
    templateHeaders: ['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'description',
      'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr',
      'cost_price_usd', 'cost_price_khr', 'stock_quantity', 'low_stock_threshold',
      'batch(mm/dd/yyyy)', 'expiry_date', 'expiry_alert_days', 'branch', 'supplier',
      'parent_id', 'is_group', 'image_filename_1', 'image_filename_2', 'image_filename_3',
      'image_filename_4', 'image_filename_5', 'image_filenames', 'is_active'],
    templateFilename: 'products-template.csv',
    howItReads: [
      'Each row is matched against your catalogue by name, then SKU, then barcode -- the first one that matches wins.',
      'A row that matches nothing becomes a new product. A row that matches updates that product.',
      'A blank cell means "leave whatever is already there" -- it does not clear the field.',
      'branch decides which branch the stock_quantity lands in. Blank uses your default branch.',
      'batch(mm/dd/yyyy) blank means today, and is stored as a code such as AUG242026.',
    ],
    guidelines: [
      'name is the only required column. Everything else can be left blank.',
      'Prices are plain numbers -- no currency symbols, no thousands separators.',
      'Use || to give a product more than one category or brand (Makeup||Skincare).',
      'image_filename_1..5 take file names only, matched against images you upload alongside.',
      'Keep the header row exactly as downloaded; your own column ORDER does not matter.',
    ],
  },
  {
    id: 'dated_reconciliation',
    icon: CalendarClock,
    label: 'Dated Stock Reconciliation',
    description: 'Upload dated stock-count snapshots; the system works out what changed between counts and applies it as real stock movements, batch by batch.',
    built: true,
    templateTitle: 'Dated Stock Reconciliation template',
    templateColumns: ['name', 'barcode', 'branch', 'date', 'stock_qty'],
    templateNote: "Continuing takes you into a column-mapping step (your file's headers don't need to match these exactly), then a review screen for any row that needs a human decision, before anything is applied.",
    templateHeaders: ['name', 'barcode', 'branch', 'date', 'stock_qty'],
    templateFilename: 'stock-reconciliation-template.csv',
    howItReads: [
      'Each row is a COUNT at a point in time, not a change -- the system works out the difference between counts itself.',
      'Rows are matched by barcode first, then name.',
      'Counts are applied in date order, per branch, and turned into real stock movements batch by batch.',
      'Anything ambiguous is held back for you to decide on a review screen before it is applied.',
    ],
    guidelines: [
      'date is the date the count was taken. One row per product, per branch, per count date.',
      'stock_qty is the quantity you actually counted -- not the difference from last time.',
      'Your headers do not have to match these names; you map them on the next step.',
    ],
  },
]

const REPLACE_OPTIONS: OptionDef[] = [
  {
    id: 'columns',
    icon: Columns3,
    label: 'Replace specific columns',
    description: 'Choose which columns (e.g. just pricing, or just images) get overwritten on matching products. Everything else on the matched product stays untouched.',
    built: false,
    templateTitle: 'Replace specific columns template',
    templateColumns: ['name or sku or barcode (to match)', '...only the column(s) you choose to replace'],
    templateNote: 'You will choose which columns this import is allowed to touch before it runs.',
    templateHeaders: ['name', 'sku', 'barcode'],
    templateFilename: 'replace-columns-template.csv',
    howItReads: [
      'Rows are matched on the identifier columns; only the columns you allow are overwritten.',
      'Every other field on a matched product is left exactly as it is.',
      'Rows that match nothing are skipped -- this mode never creates products.',
    ],
    guidelines: [
      'Keep the identifier columns, then add ONLY the columns you want overwritten.',
      'A blank cell in an allowed column WILL clear that field -- that is the point of this mode.',
    ],
  },
  {
    id: 'full_match',
    icon: RefreshCw,
    label: 'Full replace on match',
    description: "Every row that matches an existing product has that product fully overwritten with this file's version. Rows that don't match are left alone.",
    built: false,
    templateTitle: 'Full replace on match template',
    templateColumns: ['name', 'sku', 'barcode', 'category', 'brand', 'cost_price', 'selling_price', 'branch', 'stock_quantity', '...'],
    templateNote: 'Same columns as a normal products file -- the difference is every field on a matched product is overwritten, not merged.',
    templateHeaders: ['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'description',
      'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr',
      'cost_price_usd', 'cost_price_khr', 'stock_quantity', 'low_stock_threshold',
      'batch(mm/dd/yyyy)', 'expiry_date', 'expiry_alert_days', 'branch', 'supplier',
      'parent_id', 'is_group', 'image_filename_1', 'image_filename_2', 'image_filename_3',
      'image_filename_4', 'image_filename_5', 'image_filenames', 'is_active'],
    templateFilename: 'replace-full-match-template.csv',
    howItReads: [
      'Rows are matched the same way as a General import (name, then SKU, then barcode).',
      'Every field on a matched product is replaced by this file -- including fields you left blank.',
      'Rows that match nothing are left alone; this mode does not create products.',
    ],
    guidelines: [
      'Fill in every column you care about. A blank here CLEARS the value, it does not keep it.',
      'This is the difference from General: General merges, this overwrites.',
    ],
  },
  {
    id: 'full_wipe',
    icon: Trash2,
    label: 'Full wipe + reimport',
    description: 'Deletes all existing product data and loads this file as the entire new dataset. The most dangerous option here.',
    built: false,
    templateTitle: 'Full wipe + reimport template',
    templateColumns: ['name', 'sku', 'barcode', 'category', 'brand', 'cost_price', 'selling_price', 'branch', 'stock_quantity', '...'],
    templateNote: 'Equivalent to a full products data reset immediately followed by a fresh General import.',
    templateHeaders: ['name', 'sku', 'barcode', 'category', 'brand', 'unit', 'description',
      'selling_price_usd', 'selling_price_khr', 'special_price_usd', 'special_price_khr',
      'cost_price_usd', 'cost_price_khr', 'stock_quantity', 'low_stock_threshold',
      'batch(mm/dd/yyyy)', 'expiry_date', 'expiry_alert_days', 'branch', 'supplier',
      'parent_id', 'is_group', 'image_filename_1', 'image_filename_2', 'image_filename_3',
      'image_filename_4', 'image_filename_5', 'image_filenames', 'is_active'],
    templateFilename: 'replace-full-wipe-template.csv',
    howItReads: [
      'ALL existing products are deleted first, then this file is loaded as the entire catalogue.',
      'Anything not in this file will no longer exist afterwards.',
      'Take a backup before running this. It is the most destructive option on this screen.',
    ],
    guidelines: [
      'This file must contain your COMPLETE catalogue, not just the rows you want to change.',
      'Same column rules as a General import otherwise.',
    ],
  },
]

// Add-Sale covers three things in one file, not just sales: it creates or
// updates PRODUCTS, moves STOCK, and records SALES. The mode's own copy says
// so, because "Add-Sale" on its own reads as sales-only and people were
// looking elsewhere for the add-product/add-stock import.
//
// `date` is a base column, not optional. It is what makes the whole thing
// orderable: the importer has to know whether a stock arrival happened
// before or after a sale on the same product, otherwise a sale can be
// applied against stock that had not been received yet.
const ADD_SALE_BASE_COLUMNS = ['name', 'barcode', 'branch', 'date', 'stock_qty', 'selling_price']

// How rows relate to each other. Exactly one of these is always active --
// they are mutually exclusive readings of the same file, not independent
// switches.
type RowLinkMode = 'per_row' | 'one_sale' | 'by_day'

// Customer, discount and fee used to be three separate toggles sitting
// beside "link rows into one sale". They are folded into the sale-linking
// modes now, because they are not independent choices -- a sale exists
// because a customer bought something, and that sale may carry a per-row
// discount, a whole-receipt discount, a delivery fee or another fee. Asking
// someone to tick three more boxes to describe one ordinary transaction was
// busywork. The columns simply come with the template and may be left blank.
const SALE_DETAIL_COLUMNS = ['customer_name', 'customer_phone', 'membership_number', 'discount', 'fee']

interface RowLinkDef {
  id: RowLinkMode
  icon: ComponentTypeIcon
  label: string
  description: string
  columns: string[]
}

const ROW_LINK_MODES: RowLinkDef[] = [
  {
    id: 'per_row',
    icon: Layers,
    label: 'Each row on its own',
    description: 'No grouping. Every row is handled independently -- a product/stock row on its own, or a single-item sale.',
    columns: [],
  },
  {
    id: 'one_sale',
    icon: Link2,
    label: 'Group rows into one sale',
    description: 'Rows sharing a sale label become one receipt. Three rows all marked sale1 are one sale with three items; sale2 is the next receipt. Customer, discount and fee columns come with this and can be left blank.',
    columns: ['sale (sale1, sale2...)', ...SALE_DETAIL_COLUMNS],
  },
  {
    id: 'by_day',
    icon: CalendarClock,
    label: 'Link rows by day',
    description: "Rows are grouped by date and read in a sensible order within each day: new products first, then stock arrivals, then sales. A sale is never applied against stock that hadn't arrived yet. Customer, discount and fee columns come with this too.",
    columns: SALE_DETAIL_COLUMNS,
  },
]

// Cost price applies to every linking mode, which is why it is a separate
// choice rather than another toggle in the list above. Either the file
// carries it, or it is decided on the review screen after upload -- both are
// legitimate, and which one you want does not depend on how rows are linked.
type CostPriceSource = 'file' | 'review'

// Reveal-on-select: an option's full description only renders once it's
// the active one -- same pattern this session also applied to
// Backup.tsx/ResetData.tsx's own tier pickers -- keeps every unselected
// card to one line so a screen with several options doesn't read as
// text-heavy.
// Description lives behind an InfoHint rather than printed under the card.
// Every option used to render a full sentence or two inline, which made a
// list of three or four modes read as a wall of text before the reader had
// picked anything. The label is what you scan; the explanation is what you
// ask for. Applied to every mode and sub-mode on this screen.
function OptionCard({
  active, dangerous, icon: Icon, title, description, onClick,
}: { active: boolean; dangerous?: boolean; icon: ComponentTypeIcon; title: string; description: string; onClick: () => void }) {
  return (
    <div
      className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 transition ${
        active
          ? dangerous
            ? 'border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-950/30'
            : 'border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
      }`}
    >
      {/* The card is a <div> wrapping a full-width <button> rather than one
          big <button>, because the InfoHint inside is itself a button and
          nesting buttons is invalid HTML -- React renders it, but the inner
          control becomes unreliable to click. */}
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Icon className={`h-4 w-4 shrink-0 ${dangerous ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`} />
        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
      </button>
      <InfoHint text={description} label={`About ${title}`} />
    </div>
  )
}

// Sections 3-5 of the screen, in the order the layout spec fixes them:
//
//   3. Template download   -- changes with the selected mode AND options
//   4. Upload area
//   5. Informational block -- how the file is read, and how to fill it in
//
// The order matters and is not cosmetic. Previously the explanatory block
// came FIRST and there was no download at all, only chips describing the
// columns -- so the screen explained a file the person had no way to
// obtain. Download, then upload, then reference material follows the
// actual sequence of doing the task, and puts the longest text last where
// it can be skipped by someone who already knows the format.
function TemplateUploadInfo({
  title, columns, note, built, onUploadClick, headers, filename, howItReads, guidelines,
}: {
  title: string
  columns: string[]
  note: string
  built: boolean
  onUploadClick: () => void
  headers: string[]
  filename: string
  howItReads: string[]
  guidelines: string[]
}) {
  const downloadTemplate = () => {
    // Built here rather than through api/methods.ts's downloadImportTemplate:
    // that one branches on a fixed entity type, while this file's headers
    // depend on the mode AND the live option/toggle selection.
    const csv = `${headers.join(',')}
`
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return (
    <div className="space-y-3">
      {/* 3. Template */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
          </div>
          <button
            type="button"
            onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
          >
            <Download className="h-3.5 w-3.5" />
            Download template
          </button>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {columns.map((col) => (
            <span key={col} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {col}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{note}</p>
      </div>

      {/* 4. Upload */}
      {!built ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This mode&apos;s import logic isn&apos;t built yet, so it can&apos;t run from here. The template above is real, so the format can be prepared in the meantime.</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onUploadClick}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/60 px-4 py-4 text-sm font-semibold text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-300"
        >
          <UploadCloud className="h-4 w-4" />
          Upload file &amp; continue
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}

      {/* 5. Information */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">How this import works</span>
        </div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          How the system reads your file
        </p>
        <ul className="mb-3 space-y-1">
          {howItReads.map((line) => (
            <li key={line} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Filling in the template
        </p>
        <ul className="space-y-1">
          {guidelines.map((line) => (
            <li key={line} className="flex gap-2 text-xs text-slate-600 dark:text-slate-300">
              <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function ImportModeWizard({ onClose, onDone, t, products = [], branches = [] }: ImportModeWizardProps) {
  const [topMode, setTopMode] = useState<TopMode>('general')
  const [generalSubOption, setGeneralSubOption] = useState<GeneralSubOption>('add_update')
  const [replaceSubOption, setReplaceSubOption] = useState<ReplaceSubOption>('columns')
  const [rowLinkMode, setRowLinkMode] = useState<RowLinkMode>('per_row')
  const [costPriceSource, setCostPriceSource] = useState<CostPriceSource>('review')
  const [launchedModal, setLaunchedModal] = useState<'none' | 'add_update' | 'dated_reconciliation' | 'add_sale'>('none')

  if (launchedModal === 'add_update') {
    return (
      <Suspense fallback={null}>
        <BulkImportModal onClose={onClose} onDone={onDone} t={t} />
      </Suspense>
    )
  }
  if (launchedModal === 'dated_reconciliation') {
    return (
      <Suspense fallback={null}>
        <DatedStockReconciliationModal onClose={onClose} onDone={onDone} t={t} products={products} />
      </Suspense>
    )
  }
  if (launchedModal === 'add_sale') {
    return (
      <Suspense fallback={null}>
        <StockActionImportModal onClose={onClose} onDone={onDone} t={t} />
      </Suspense>
    )
  }

  const selectedGeneral = GENERAL_OPTIONS.find((option) => option.id === generalSubOption) || GENERAL_OPTIONS[0]
  const selectedReplace = REPLACE_OPTIONS.find((option) => option.id === replaceSubOption) || REPLACE_OPTIONS[0]

  function handleUpload() {
    if (topMode === 'general') {
      setLaunchedModal(generalSubOption === 'dated_reconciliation' ? 'dated_reconciliation' : 'add_update')
    } else if (topMode === 'add_sale') {
      setLaunchedModal('add_sale')
    }
    // Replace still has no backend yet -- its upload button is never
    // rendered (InfoTemplateUpload shows the "not built yet" banner
    // instead), so there's nothing else to launch here.
  }

  const activeLink = ROW_LINK_MODES.find((mode) => mode.id === rowLinkMode) || ROW_LINK_MODES[0]
  const linksIntoSales = rowLinkMode !== 'per_row'

  const addSaleColumns = [
    ...ADD_SALE_BASE_COLUMNS,
    ...activeLink.columns,
    ...(costPriceSource === 'file' ? ['cost_price'] : []),
  ]

  const addSaleNote = linksIntoSales
    ? `${activeLink.label} -- the template below carries the sale columns for this mode. Any of them may be left blank.`
    : 'Each row stands alone. Add the sale columns by choosing one of the linking modes above.'

  // Downloaded header row. Two of the chips above are descriptive rather
  // than literal -- 'sale (sale1, sale2...)' is a column called `sale` --
  // so the real names are mapped here.
  const addSaleTemplateHeaders = [
    ...ADD_SALE_BASE_COLUMNS,
    ...activeLink.columns.map((col) => (col.startsWith('sale (') ? 'sale' : col)),
    ...(costPriceSource === 'file' ? ['cost_price'] : []),
  ]

  const addSaleHowItReads = [
    'Every row can create or update a PRODUCT, move STOCK, and record a SALE -- all three, in one file.',
    'Products are matched by barcode first, then name. No match creates a new product.',
    'branch decides which branch the stock moves in and which branch the sale belongs to.',
    'date orders the work. Within a date, new products are created first, then stock arrivals, then sales -- so a sale is never applied against stock that had not arrived yet.',
    ...(rowLinkMode === 'one_sale'
      ? ['Rows sharing a sale label become ONE receipt: three rows marked sale1 are one sale with three items.']
      : []),
    ...(rowLinkMode === 'by_day'
      ? ['Rows are grouped by date. Everything sold on a day is treated as that day\'s sales, tagged with the day and its item count.']
      : []),
    ...(rowLinkMode === 'per_row'
      ? ['With no linking, a row with stock_qty but no selling_price is a stock arrival, and a row with a selling_price is a single-item sale.']
      : []),
    ...(linksIntoSales
      ? ['customer_name / customer_phone / membership_number attach a customer when filled. Membership number wins, then phone, then name.']
      : []),
    ...(linksIntoSales
      ? ['discount and fee may be set per row, or once on the first row of a sale to apply to the whole receipt.']
      : []),
    costPriceSource === 'file'
      ? 'cost_price comes from this file and overrides whatever the matched product has.'
      : 'cost price is not in this file -- you choose it on the review screen after uploading, or it is taken from the matched product.',
  ]

  const addSaleGuidelines = [
    'name, barcode, branch and date are always required. stock_qty and selling_price depend on what the row is doing.',
    'selling_price is what the item actually SOLD for, which may differ from the catalogue price.',
    'Leave a column blank when it does not apply -- blank is meaningful here and is never treated as 0.',
    ...(rowLinkMode === 'one_sale'
      ? ['Put the same sale label on every line of one receipt (sale1 on all its lines, sale2 on the next).']
      : []),
    ...(rowLinkMode === 'by_day'
      ? ['One date per row. Rows do not need to be sorted -- the importer orders them itself.']
      : []),
    ...(linksIntoSales
      ? ['Customer, discount and fee are optional. A sale with none of them filled in is perfectly valid.']
      : []),
    ...(costPriceSource === 'file'
      ? ['cost_price is per row, matching the stock arriving on that row -- useful when a batch was bought at a different price.']
      : []),
  ]

  return (
    <Modal title={t('import_products', 'Import Products')} onClose={onClose} size="lg">
      {/* Mini mode switcher -- always visible at the top of the screen. */}
      <div className="mb-4 grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/60">
        <button
          type="button"
          onClick={() => setTopMode('general')}
          className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
            topMode === 'general'
              ? 'bg-white text-blue-700 shadow dark:bg-slate-900 dark:text-blue-400'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          General
        </button>
        <button
          type="button"
          onClick={() => setTopMode('replace')}
          className={`inline-flex items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold transition ${
            topMode === 'replace'
              ? 'bg-white text-red-700 shadow dark:bg-slate-900 dark:text-red-400'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Replace
        </button>
        <button
          type="button"
          onClick={() => setTopMode('add_sale')}
          className={`rounded-lg px-2 py-2 text-xs font-semibold transition ${
            topMode === 'add_sale'
              ? 'bg-white text-emerald-700 shadow dark:bg-slate-900 dark:text-emerald-400'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Add-Sale
        </button>
      </div>

      {topMode === 'general' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            {GENERAL_OPTIONS.map((option) => (
              <OptionCard
                key={option.id}
                active={generalSubOption === option.id}
                icon={option.icon}
                title={option.label}
                description={option.description}
                onClick={() => setGeneralSubOption(option.id as GeneralSubOption)}
              />
            ))}
          </div>
          <TemplateUploadInfo
            title={selectedGeneral.templateTitle}
            columns={selectedGeneral.templateColumns}
            note={selectedGeneral.templateNote}
            built={selectedGeneral.built}
            onUploadClick={handleUpload}
            headers={selectedGeneral.templateHeaders}
            filename={selectedGeneral.templateFilename}
            howItReads={selectedGeneral.howItReads}
            guidelines={selectedGeneral.guidelines}
          />
        </div>
      ) : null}

      {topMode === 'replace' ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/10 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Replace mode overwrites existing product data. Pick which behavior below.</span>
          </div>
          <div className="space-y-2">
            {REPLACE_OPTIONS.map((option) => (
              <OptionCard
                key={option.id}
                active={replaceSubOption === option.id}
                dangerous
                icon={option.icon}
                title={option.label}
                description={option.description}
                onClick={() => setReplaceSubOption(option.id as ReplaceSubOption)}
              />
            ))}
          </div>
          <TemplateUploadInfo
            title={selectedReplace.templateTitle}
            columns={selectedReplace.templateColumns}
            note={selectedReplace.templateNote}
            built={selectedReplace.built}
            onUploadClick={handleUpload}
            headers={selectedReplace.templateHeaders}
            filename={selectedReplace.templateFilename}
            howItReads={selectedReplace.howItReads}
            guidelines={selectedReplace.guidelines}
          />
        </div>
      ) : null}

      {topMode === 'add_sale' ? (
        <div className="space-y-4">
          <div className="mb-1 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              One file that adds products, moves stock and records sales together.
              Required on every row: name, barcode, branch, date.
            </span>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              How rows relate to each other
            </p>
            <div className="space-y-2">
              {ROW_LINK_MODES.map((mode) => (
                <OptionCard
                  key={mode.id}
                  active={rowLinkMode === mode.id}
                  icon={mode.icon}
                  title={mode.label}
                  description={mode.description}
                  onClick={() => setRowLinkMode(mode.id)}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Cost price
            </p>
            <div className="space-y-2">
              <OptionCard
                active={costPriceSource === 'review'}
                icon={Coins}
                title="Decide after upload"
                description="No cost_price column. On the review screen you set it, or it is taken from the matched existing product. Best when the file came from somewhere that does not know your costs."
                onClick={() => setCostPriceSource('review')}
              />
              <OptionCard
                active={costPriceSource === 'file'}
                icon={Coins}
                title="Cost price is in the file"
                description="Adds a cost_price column, applied per row. Use this when different batches were bought at different prices, since each row carries the cost of the stock arriving on it."
                onClick={() => setCostPriceSource('file')}
              />
            </div>
          </div>

          <TemplateUploadInfo
            title="Add products, stock & sales template"
            columns={addSaleColumns}
            note={addSaleNote}
            built
            onUploadClick={handleUpload}
            headers={addSaleTemplateHeaders}
            filename="add-stock-sale-template.csv"
            howItReads={addSaleHowItReads}
            guidelines={addSaleGuidelines}
          />
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {t('cancel', 'Cancel')}
        </button>
      </div>
    </Modal>
  )
}
