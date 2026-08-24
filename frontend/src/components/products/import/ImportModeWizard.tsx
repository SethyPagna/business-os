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
// - Add-Sale is now its own top-level mode (previously a General
//   sub-option) since its shape is different: instead of picking ONE of
//   several fixed sub-options, it presents a set of independently
//   selectable toggles (link to a sale, attach a customer, include
//   discount, include fee, supply cost price in file). Each toggle
//   updates the template's column list and note live -- this is the
//   "select/unselect updates the information, template, upload
//   accordingly" behavior asked for.
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
import Layers from 'lucide-react/dist/esm/icons/layers.js'
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock.js'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Columns3 from 'lucide-react/dist/esm/icons/columns-3.js'
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Info from 'lucide-react/dist/esm/icons/info.js'
import Link2 from 'lucide-react/dist/esm/icons/link.js'
import Users from 'lucide-react/dist/esm/icons/users.js'
import Percent from 'lucide-react/dist/esm/icons/percent.js'
import Receipt from 'lucide-react/dist/esm/icons/receipt.js'
import Coins from 'lucide-react/dist/esm/icons/coins.js'
import CheckSquare from 'lucide-react/dist/esm/icons/check-square.js'
import Square from 'lucide-react/dist/esm/icons/square.js'
import UploadCloud from 'lucide-react/dist/esm/icons/upload-cloud.js'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import Modal from '../../shared/Modal'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { Suspense } from 'react'

const BulkImportModal = lazyRetry(() => import('./BulkImportModal'), 'products-bulk-import-legacy')
const DatedStockReconciliationModal = lazyRetry(() => import('./DatedStockReconciliationModal'), 'products-dated-stock-reconciliation-import')
const AddSaleImportModal = lazyRetry(() => import('./AddSaleImportModal'), 'products-add-sale-import')

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
  templateColumns: string[]
  templateNote: string
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
  },
]

// Add-Sale's own set of independently selectable toggles. Unlike
// General/Replace (pick exactly one fixed option), Add-Sale always
// imports the same base shape (name, barcode, branch, stock_qty,
// selling_price) and these toggles layer optional columns on top --
// each one flips its own columns in/out of the template shown below,
// live.
const ADD_SALE_BASE_COLUMNS = ['name', 'barcode', 'branch', 'stock_qty', 'selling_price']

interface AddSaleToggleDef {
  id: 'cost_price' | 'link_sale' | 'customer' | 'discount' | 'fee'
  icon: ComponentTypeIcon
  label: string
  description: string
  columns: string[]
}

const ADD_SALE_TOGGLES: AddSaleToggleDef[] = [
  {
    id: 'cost_price',
    icon: Coins,
    label: 'Supply cost price in file',
    description: "Off: cost price is resolved from a matching existing product. On: this file's own cost_price column is used instead.",
    columns: ['cost_price'],
  },
  {
    id: 'link_sale',
    icon: Link2,
    label: 'Link rows into one sale',
    description: 'Rows sharing the same "action" label become line items of one sales receipt. Left off, every row is its own reconciliation-flagged sale.',
    columns: ['action (sale1, sale2...)'],
  },
  {
    id: 'customer',
    icon: Users,
    label: 'Attach a customer',
    description: 'Link each sale to a customer by name/phone, or by membership number.',
    columns: ['customer_name', 'customer_phone', 'membership_number'],
  },
  {
    id: 'discount',
    icon: Percent,
    label: 'Include discount',
    description: 'Apply a per-row discount to the sale.',
    columns: ['discount'],
  },
  {
    id: 'fee',
    icon: Receipt,
    label: 'Include fee',
    description: 'Apply a per-row fee to the sale.',
    columns: ['fee'],
  },
]

// Reveal-on-select: an option's full description only renders once it's
// the active one -- same pattern this session also applied to
// Backup.tsx/ResetData.tsx's own tier pickers -- keeps every unselected
// card to one line so a screen with several options doesn't read as
// text-heavy.
function OptionCard({
  active, dangerous, icon: Icon, title, description, onClick,
}: { active: boolean; dangerous?: boolean; icon: ComponentTypeIcon; title: string; description: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition ${
        active
          ? dangerous
            ? 'border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-950/30'
            : 'border-blue-600 bg-blue-50 dark:border-blue-500 dark:bg-blue-950/30'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${dangerous ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        {active ? <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{description}</span> : null}
      </span>
    </button>
  )
}

// Add-Sale's own toggle row: a checkbox-style card, several can be
// active at once (unlike OptionCard, which is single-select within its
// group).
function ToggleCard({
  active, icon: Icon, title, description, onClick,
}: { active: boolean; icon: ComponentTypeIcon; title: string; description: string; onClick: () => void }) {
  const CheckIcon = active ? CheckSquare : Square
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl border-2 p-3 text-left transition ${
        active
          ? 'border-emerald-500 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/30'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
      }`}
    >
      <CheckIcon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{description}</span>
      </span>
    </button>
  )
}

// The info-toolkit + template + upload section shared by all three
// modes -- always sits directly under whichever mode/option is
// currently selected, on the same screen (no separate step to reach
// it).
function InfoTemplateUpload({
  title, columns, note, built, onUploadClick,
}: { title: string; columns: string[]; note: string; built: boolean; onUploadClick: () => void }) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-2 flex items-center gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {columns.map((col) => (
            <span key={col} className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {col}
            </span>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{note}</p>
      </div>

      {!built ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This mode's import logic isn't built yet, so it can't run from here. It's shown so the design and template are visible while it's being built.</span>
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
    </div>
  )
}

export default function ImportModeWizard({ onClose, onDone, t, products = [], branches = [] }: ImportModeWizardProps) {
  const [topMode, setTopMode] = useState<TopMode>('general')
  const [generalSubOption, setGeneralSubOption] = useState<GeneralSubOption>('add_update')
  const [replaceSubOption, setReplaceSubOption] = useState<ReplaceSubOption>('columns')
  const [addSaleToggles, setAddSaleToggles] = useState<Record<AddSaleToggleDef['id'], boolean>>({
    cost_price: false,
    link_sale: false,
    customer: false,
    discount: false,
    fee: false,
  })
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
        <AddSaleImportModal onClose={onClose} onDone={onDone} t={t} branches={branches} />
      </Suspense>
    )
  }

  const selectedGeneral = GENERAL_OPTIONS.find((option) => option.id === generalSubOption) || GENERAL_OPTIONS[0]
  const selectedReplace = REPLACE_OPTIONS.find((option) => option.id === replaceSubOption) || REPLACE_OPTIONS[0]

  function toggleAddSale(id: AddSaleToggleDef['id']) {
    setAddSaleToggles((prev) => ({ ...prev, [id]: !prev[id] }))
  }

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

  const addSaleColumns = [
    ...ADD_SALE_BASE_COLUMNS,
    ...ADD_SALE_TOGGLES.filter((toggle) => addSaleToggles[toggle.id]).flatMap((toggle) => toggle.columns),
  ]
  const addSaleActiveCount = ADD_SALE_TOGGLES.filter((toggle) => addSaleToggles[toggle.id]).length
  const addSaleNote = addSaleActiveCount > 0
    ? `${addSaleActiveCount} optional field group${addSaleActiveCount === 1 ? '' : 's'} selected -- the template above updates as you select/unselect them. Minimum required fields are always included.`
    : 'Minimum fields only, shown above. Select any toggle below to add its columns to the template.'

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
          <InfoTemplateUpload
            title={selectedGeneral.templateTitle}
            columns={selectedGeneral.templateColumns}
            note={selectedGeneral.templateNote}
            built={selectedGeneral.built}
            onUploadClick={handleUpload}
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
          <InfoTemplateUpload
            title={selectedReplace.templateTitle}
            columns={selectedReplace.templateColumns}
            note={selectedReplace.templateNote}
            built={selectedReplace.built}
            onUploadClick={handleUpload}
          />
        </div>
      ) : null}

      {topMode === 'add_sale' ? (
        <div className="space-y-4">
          <div className="mb-1 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Minimum fields: name, barcode, branch, stock quantity, selling price. Select any of the optional fields below to add them to this import.</span>
          </div>
          <div className="space-y-2">
            {ADD_SALE_TOGGLES.map((toggle) => (
              <ToggleCard
                key={toggle.id}
                active={addSaleToggles[toggle.id]}
                icon={toggle.icon}
                title={toggle.label}
                description={toggle.description}
                onClick={() => toggleAddSale(toggle.id)}
              />
            ))}
          </div>
          <InfoTemplateUpload
            title="Add & Link to Sales template"
            columns={addSaleColumns}
            note={addSaleNote}
            built
            onUploadClick={handleUpload}
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
