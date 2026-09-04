import { useCallback, useMemo, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../../AppContext.tsx'
import Modal from '../../shared/Modal'
import { useFormDirty } from '../../../utils/formDirty.ts'
import { parseNumericInput, sanitizeNumericInput } from '../shared/primitives'
import { formatPriceNumber, normalizePriceValue } from '../../../utils/pricing.ts'
import { extractHistoryResultId } from '../../../utils/historyHelpers.ts'
import { beginSingleAction, finishSingleAction } from '../../../utils/actionGuards.ts'
import { withLoaderTimeout } from '../../../utils/loaders.ts'
import AppSelect, { type AppSelectOption } from '../../shared/AppSelect.tsx'
import { normalizeProductGroupName } from '../../../utils/productGrouping.ts'

const PRODUCT_VARIANT_MUTATION_TIMEOUT_MS = 12000

type EntityId = string | number

interface VariantParentProduct {
  id: EntityId
  name: string
  supplier?: string | null
  unit?: string | null
  category?: string | null
  cost_price_usd?: number | string | null
  cost_price_khr?: number | string | null
  selling_price_usd?: number | string | null
  selling_price_khr?: number | string | null
  wholesale_price_usd?: number | string | null
  wholesale_price_khr?: number | string | null
}

interface UnitOption {
  id: EntityId
  name: string
}

interface BranchOption {
  id: EntityId
  name: string
  is_default?: boolean | number | null
}

interface VariantUser {
  id?: EntityId
  name?: string
}

interface VariantFormState {
  name: string
  sku: string
  barcode: string
  description: string
  supplier: string
  cost_price_usd: string
  cost_price_khr: string
  selling_price_usd: string
  selling_price_khr: string
  wholesale_price_usd: string
  wholesale_price_khr: string
  stock_quantity: string
  branch_id: EntityId | ''
  unit: string
  category: string
}

type NumericVariantField =
  | 'cost_price_usd'
  | 'cost_price_khr'
  | 'selling_price_usd'
  | 'selling_price_khr'
  | 'wholesale_price_usd'
  | 'wholesale_price_khr'
  | 'stock_quantity'

interface VariantMutationResponse {
  success?: boolean
  error?: string
  id?: unknown
  data?: { id?: unknown } | null
  item?: { id?: unknown } | null
}

interface ProductVariantApi {
  createProductVariant: (payload: Record<string, unknown>) => Promise<VariantMutationResponse | undefined>
}

interface VariantDonePayload {
  createdProductId: number
  clientRequestId: string
  snapshot: Record<string, unknown>
}

interface VariantFormModalProps {
  parent: VariantParentProduct
  units: UnitOption[]
  branches: BranchOption[]
  user?: VariantUser | null
  onClose: () => void
  onDone?: (payload: VariantDonePayload) => void
  t: (key: string) => string | undefined
  usdSymbol: string
}

const useApp = useAppHook as () => {
  notify: (message: string, type?: string) => void
}

function getProductVariantApi(): ProductVariantApi {
  return (window as unknown as { api: ProductVariantApi }).api
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default function VariantFormModal({ parent, units, branches, user, onClose, onDone, t, usdSymbol }: VariantFormModalProps) {
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')
  const tr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = typeof t === 'function' ? t(key) : null
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }
  const [form, setForm] = useState<VariantFormState>({
    // Previously defaulted to `${parent.name} (Variant)` -- but every
    // family/variant grouping check in the app (buildProductGroups here,
    // findIdentityMatch for transfers, classifyProducts for CSV import --
    // see progress.md's "Multi-select transfer/import grouping rule"
    // decision) requires the name to match the parent *exactly* (aside
    // from case/whitespace) to be treated as the same family. A "(Variant)"
    // suffix silently opted every variant created through this form out of
    // its own family grouping unless the operator noticed and manually
    // deleted the suffix -- it would show up everywhere else in the app as
    // a standalone unrelated product, not a variant of `parent.name`.
    // Defaulting to the bare parent name (still fully editable) means the
    // common case -- a variant distinguished by price/barcode/branch, not
    // by name -- works correctly with no edit required.
    name: parent.name,
    sku: '',
    barcode: '',
    description: '',
    supplier: parent.supplier || '',
    cost_price_usd: formatPriceNumber(parent.cost_price_usd || 0),
    cost_price_khr: formatPriceNumber(parent.cost_price_khr || 0),
    selling_price_usd: formatPriceNumber(parent.selling_price_usd || 0),
    selling_price_khr: formatPriceNumber(parent.selling_price_khr || 0),
    // No `?? parent.selling_price` fallback. A parent with no wholesale price
    // must seed a BLANK wholesale field, not the selling price: seeding it
    // with selling meant every variant created from such a parent was saved
    // carrying a "wholesale price" equal to its selling price, which the POS
    // then offered as a tier that discounts nothing.
    wholesale_price_usd: formatPriceNumber(parent.wholesale_price_usd || 0),
    wholesale_price_khr: formatPriceNumber(parent.wholesale_price_khr || 0),
    stock_quantity: '0',
    branch_id: branches.find((branch) => branch.is_default)?.id || '',
    unit: parent.unit || 'pcs',
    category: parent.category || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // S4-21: dismissing this modal with edits raises the discard prompt.
  const { dirty: formDirty } = useFormDirty(form, String(parent?.id ?? 'new'))
  const saveInFlightRef = useRef(false)
  const { notify } = useApp()

  const setField = <Key extends keyof VariantFormState>(key: Key, value: VariantFormState[Key]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }
  const setNumeric = (key: NumericVariantField, value: string): void => setField(key, sanitizeNumericInput(value))
  const runVariantMutation = useCallback((loader: () => Promise<VariantMutationResponse | undefined>, label: string) => (
    withLoaderTimeout(loader, label, PRODUCT_VARIANT_MUTATION_TIMEOUT_MS)
  ), [])
  const unitOptions = useMemo<AppSelectOption[]>(() => {
    const options = units.map((unit) => ({ value: unit.name, label: unit.name }))
    if (form.unit && !options.some((option) => String(option.value) === String(form.unit))) {
      return [{ value: form.unit, label: form.unit }, ...options]
    }
    return options
  }, [form.unit, units])
  // Non-blocking warning (not a hard validation error) -- a genuinely
  // different name is a valid choice (e.g. the operator decided this isn't
  // really the same product family after all), it just means the result
  // won't group under `parent.name` the way every other variant does. Case/
  // whitespace-only differences don't trigger this -- normalizeProductGroupName
  // is the same normalization buildProductGroups actually groups by, so
  // this warning only fires when the real grouping key would actually differ.
  const nameDiffersFromParent = form.name.trim() !== ''
    && normalizeProductGroupName(form.name) !== normalizeProductGroupName(parent.name)

  const branchOptions = useMemo<AppSelectOption[]>(() => [
    { value: '', label: tr('default_branch_option', 'Default branch') },
    ...branches.map((branch) => ({
      value: branch.id,
      label: branch.is_default ? `${branch.name} (${t('default_label') || 'Default'})` : branch.name,
    })),
  ], [branches, t])

  const handleSave = async (): Promise<void> => {
    if (saving) return
    if (!beginSingleAction(saveInFlightRef, { blocked: saving })) return
    if (!form.name.trim()) {
      setErr(tr('variant_name_required', 'Variant name is required', 'ត្រូវការឈ្មោះវ៉ារីយ៉ង់'))
      finishSingleAction(saveInFlightRef)
      return
    }

    setSaving(true)
    setErr('')
    try {
      const clientRequestId = `variant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const response = await runVariantMutation(() => getProductVariantApi().createProductVariant({
        client_request_id: clientRequestId,
        ...form,
        // Name is the only grouping key. Every created row stays ordinary;
        // matching names are wrapped by the virtual group title in the UI.
        selling_price_usd: normalizePriceValue(parseNumericInput(form.selling_price_usd)),
        selling_price_khr: normalizePriceValue(parseNumericInput(form.selling_price_khr)),
        wholesale_price_usd: normalizePriceValue(parseNumericInput(form.wholesale_price_usd)),
        wholesale_price_khr: normalizePriceValue(parseNumericInput(form.wholesale_price_khr)),
        stock_quantity: parseNumericInput(form.stock_quantity),
        cost_price_usd: normalizePriceValue(parseNumericInput(form.cost_price_usd)),
        cost_price_khr: normalizePriceValue(parseNumericInput(form.cost_price_khr)),
        userId: user?.id,
        userName: user?.name,
      }), 'Create product variant')

      if (response?.success === false) {
        setErr(response.error || tr('failed', 'Failed', 'បរាជ័យ'))
        return
      }

      notify(
        tr('variant_added_to_parent', 'Variant "{variant}" added to {product}', 'បានបន្ថែមវ៉ារីយ៉ង់ "{variant}" ទៅ {product}')
          .replace('{variant}', form.name)
          .replace('{product}', parent.name),
        'success',
      )
      onDone?.({
        createdProductId: extractHistoryResultId(response),
        clientRequestId,
        snapshot: {
          ...form,
          // Name is the only grouping key. Every created row stays ordinary;
          // matching names are wrapped by the virtual group title in the UI.
          stock_quantity: parseNumericInput(form.stock_quantity),
          selling_price_usd: normalizePriceValue(parseNumericInput(form.selling_price_usd)),
          selling_price_khr: normalizePriceValue(parseNumericInput(form.selling_price_khr)),
          wholesale_price_usd: normalizePriceValue(parseNumericInput(form.wholesale_price_usd)),
          wholesale_price_khr: normalizePriceValue(parseNumericInput(form.wholesale_price_khr)),
          cost_price_usd: normalizePriceValue(parseNumericInput(form.cost_price_usd)),
          cost_price_khr: normalizePriceValue(parseNumericInput(form.cost_price_khr)),
        },
      })
    } catch (error) {
      setErr(getErrorMessage(error, tr('failed', 'Failed', 'បរាជ័យ')))
    } finally {
      finishSingleAction(saveInFlightRef)
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`${t('add_variant_to') || 'Add Variant to:'} ${parent.name}`}
      onClose={onClose}
      size="lg"
      unsavedChanges={{ dirty: formDirty }}>
      <div className="space-y-4">
        <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
          {tr('variant_helper_text', 'Variants of the same product group can have different prices, barcodes, and suppliers.', 'វ៉ារីយ៉ង់ក្នុងក្រុមផលិតផលដូចគ្នា អាចមានតម្លៃ បារកូដ និងអ្នកផ្គត់ផ្គង់ខុសគ្នា។')}
        </div>

        {err ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20">{err}</div> : null}

        <div data-testid="variant-fields" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 sm:col-span-2">
            <label htmlFor="variant-form-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('variant_name', 'Variant Name', 'ឈ្មោះវ៉ារីយ៉ង់')} *
            </label>
            <input
              id="variant-form-name"
              name="variant_name"
              className="input min-h-11 min-w-0"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder={tr('variant_name_placeholder', 'e.g. Product A - Blue, 500ml, Size L', 'ឧ. ផលិតផល A - ពណ៌ខៀវ 500ml ទំហំ L')}
            />
            {nameDiffersFromParent ? (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {tr(
                  'variant_name_mismatch_warning',
                  'This name is different from "{parent}" -- it will show up as its own separate product, not grouped as a variant under {parent}.',
                  'ឈ្មោះនេះខុសពី "{parent}" -- វានឹងបង្ហាញជាផលិតផលដាច់ដោយឡែក មិនត្រូវបានដាក់ជាក្រុមជាវ៉ារីយ៉ង់នៅក្រោម {parent} ទេ។',
                ).split('{parent}').join(parent.name)}
              </p>
            ) : null}
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-barcode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('barcode') || 'Barcode'}
            </label>
            <input id="variant-form-barcode" name="variant_barcode" className="input min-h-11 min-w-0" value={form.barcode} onChange={(event) => setField('barcode', event.target.value)} />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-supplier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('supplier') || 'Supplier'}
            </label>
            <input id="variant-form-supplier" name="variant_supplier" className="input min-h-11 min-w-0" value={form.supplier} onChange={(event) => setField('supplier', event.target.value)} />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-unit" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('unit') || 'Unit'}
            </label>
            <AppSelect
              id="variant-form-unit"
              name="variant_unit"
              className="w-full min-w-0"
              buttonClassName="min-h-11 w-full min-w-0"
              value={form.unit}
              options={unitOptions}
              onChange={(value) => setField('unit', value)}
              ariaLabel={t('unit') || 'Unit'}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-cost-price" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('cost_price_usd') || `Cost Price (${usdSymbol})`}
            </label>
            <input
              id="variant-form-cost-price"
              name="variant_cost_price_usd"
              className="input min-h-11 min-w-0"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.cost_price_usd ?? ''}
              onChange={(event) => setNumeric('cost_price_usd', event.target.value)}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-selling-price" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('selling_price_usd') || `Selling Price (${usdSymbol})`}
            </label>
            <input
              id="variant-form-selling-price"
              name="variant_selling_price_usd"
              className="input min-h-11 min-w-0"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.selling_price_usd ?? ''}
              onChange={(event) => setNumeric('selling_price_usd', event.target.value)}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-wholesale-price" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('wholesale_price_usd_full', 'Wholesale (USD)', 'បោះដុំ (USD)')}
            </label>
            <input
              id="variant-form-wholesale-price"
              name="variant_wholesale_price_usd"
              className="input min-h-11 min-w-0"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.wholesale_price_usd ?? ''}
              onChange={(event) => setNumeric('wholesale_price_usd', event.target.value)}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-wholesale-price-khr" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('wholesale_price_khr_full', 'Wholesale (KHR)', 'បោះដុំ (KHR)')}
            </label>
            <input
              id="variant-form-wholesale-price-khr"
              name="variant_wholesale_price_khr"
              className="input min-h-11 min-w-0"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.wholesale_price_khr ?? ''}
              onChange={(event) => setNumeric('wholesale_price_khr', event.target.value)}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-stock" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('initial_stock', 'Initial Stock', 'ស្តុកដើម')}
            </label>
            <input
              id="variant-form-stock"
              name="variant_stock_quantity"
              className="input min-h-11 min-w-0"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.stock_quantity ?? ''}
              onChange={(event) => setNumeric('stock_quantity', event.target.value)}
            />
          </div>

          <div className="min-w-0">
            <label htmlFor="variant-form-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {tr('assign_to_branch', 'Assign to Branch', 'កំណត់ទៅសាខា')}
            </label>
            <AppSelect
              id="variant-form-branch"
              name="variant_branch_id"
              className="w-full min-w-0"
              buttonClassName="min-h-11 w-full min-w-0"
              value={form.branch_id || ''}
              options={branchOptions}
              onChange={(value) => setField('branch_id', value)}
              ariaLabel={tr('assign_to_branch', 'Assign to Branch')}
            />
          </div>
        </div>

        {/* Sticky footer, same pattern as ProductForm.tsx/FeeForm.tsx/
            CustomerFormModal.tsx's own fix. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
          <button type="button" className="btn-primary min-h-11 flex-1" onClick={handleSave} disabled={saving}>
            {saving ? (t('saving') || 'Saving...') : (t('add_variant') || 'Add Variant')}
          </button>
          <button type="button" className="btn-secondary min-h-11" onClick={onClose} disabled={saving}>{t('cancel') || 'Cancel'}</button>
        </div>
      </div>
    </Modal>
  )
}
