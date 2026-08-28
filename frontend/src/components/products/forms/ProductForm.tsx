import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, DragEvent } from 'react'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import { registerDirtyWork } from '../../../utils/dirtyWork.ts'
import ScanLine from 'lucide-react/dist/esm/icons/scan-line.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import Trash2Icon from 'lucide-react/dist/esm/icons/trash-2.js'
import LockIcon from 'lucide-react/dist/esm/icons/lock.js'
import AlertTriangleIcon from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Modal from '../../shared/Modal'
import AppSelect, { type AppSelectOption } from '../../shared/AppSelect.tsx'
import { MarginCard, DualPriceInput, parseNumericInput, sanitizeNumericInput } from '../shared/primitives'
import BranchStockAdjuster from './BranchStockAdjuster'
import { calculateProductDiscount, formatPriceNumber, normalizePriceValue } from '../../../utils/pricing.ts'
import RenameCascadeModal, { type RenameCascadeChoice, type RenameCascadeRequest } from '../../shared/RenameCascadeModal.tsx'
import { getRenameImpact, renameBrandEverywhere } from '../../../api/renameCascadeTransport.ts'
import { classifyCreateMatches, type CreateMatchVerdict, type CreateMatchCandidate } from '../helpers/productCreateMatch.ts'
import { searchProducts as searchProductsForMatch } from '../../../api/methods.ts'
import { buildCacheBustedMediaPath } from '../../../utils/mediaUpload.ts'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from '../../../utils/loaders.ts'
import { ADMIN_MAX_PRODUCT_GALLERY_IMAGES, MAX_PRODUCT_GALLERY_IMAGES } from '../helpers/productGalleryHelpers.ts'

const BarcodeScannerModal = lazyRetry(() => import('../scanning/BarcodeScannerModal'), 'product-form-barcode-scanner-modal')
const PRODUCT_SUPPLIERS_TIMEOUT_MS = 8000
const PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS = 30000

type EntityId = string | number
type EditableNumber = string | number | null | undefined
type ProductFormTab = 'basic' | 'pricing' | 'stock' | 'expiry'
type ScannerField = 'sku' | 'barcode'
type Translate = (key: string) => string

interface CategoryOption {
  id: EntityId
  name: string
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

interface ProductUser {
  id?: EntityId
  name?: string
  username?: string
  role_code?: string
  permissions?: unknown
  role_permissions?: unknown
}

interface GroupCandidate {
  id?: EntityId | null
  name?: string | null
  parent_id?: EntityId | null
}

interface SupplierOption {
  id: EntityId
  name?: string | null
  company?: string | null
}

interface ProductFormState extends GroupCandidate {
  name?: string
  sku?: string
  barcode?: string
  category?: string
  brand?: string
  description?: string
  selling_price_usd?: EditableNumber
  selling_price_khr?: EditableNumber
  special_price_usd?: EditableNumber
  special_price_khr?: EditableNumber
  discount_enabled?: number | boolean
  discount_type?: 'percent' | 'fixed' | string
  discount_percent?: EditableNumber
  discount_amount_usd?: EditableNumber
  discount_amount_khr?: EditableNumber
  discount_label?: string
  discount_badge_color?: string
  discount_starts_at?: string | null
  discount_ends_at?: string | null
  cost_price_usd?: EditableNumber
  cost_price_khr?: EditableNumber
  stock_quantity?: EditableNumber
  low_stock_threshold?: EditableNumber
  out_of_stock_threshold?: EditableNumber
  expiry_date?: string | null
  expiry_alert_days?: EditableNumber
  unit?: string
  supplier?: string
  tag_label?: string
  image_path?: string | null
  image_gallery?: unknown[]
  branch_stock?: Array<{ branch_id?: EntityId | null; quantity?: unknown }>
  branch_id?: EntityId | ''
  is_group?: number | boolean | null
}

interface ProductSavePayload extends ProductFormState {
  selling_price_usd: number
  selling_price_khr: number
  special_price_usd: number
  special_price_khr: number
  discount_enabled: 0 | 1
  discount_type: 'percent' | 'fixed'
  discount_percent: number
  discount_amount_usd: number
  discount_amount_khr: number
  discount_label: string
  discount_badge_color: string
  discount_starts_at: string | null
  discount_ends_at: string | null
  cost_price_usd: number
  cost_price_khr: number
  stock_quantity: number
  low_stock_threshold: number
  out_of_stock_threshold: number
  expiry_date: string | null
  expiry_alert_days: number
  image_gallery: string[]
  image_path: string
  is_group: 0 | 1
  parent_id: number | null
}

interface ProductImageUploadResult {
  public_path?: unknown
  path?: unknown
  cache_version?: unknown
  asset?: {
    public_path?: unknown
    updated_at?: unknown
    created_at?: unknown
  } | null
  data?: {
    path?: unknown
  } | null
}

interface FilePickerModalProps {
  open: boolean
  mediaType: string
  title: string
  onClose: () => void
  onSelect: (publicPath: string) => void
}

interface ProductFormProps {
  product?: ProductFormState | null
  categories: CategoryOption[]
  units: UnitOption[]
  branches: BranchOption[]
  brandOptions?: string[]
  groupCandidates?: GroupCandidate[]
  onSave: (payload?: ProductSavePayload) => unknown | Promise<unknown>
  onClose: () => void
  // Optional -- only supplied by callers that already have a delete flow
  // wired (Products.tsx routes this through its DeleteConfirmModal, same
  // as every other delete entry point on that page). Omitted entirely
  // when this form is used to CREATE a new product (there's nothing yet
  // to delete), and the footer button below only renders when both this
  // prop is present AND `product` is set, so a fresh "Add product" form
  // never shows it.
  onDelete?: () => void
  t: Translate
  usdSymbol: string
  khrSymbol: string
  exchangeRate: number
  user?: ProductUser | null
  initialTab?: ProductFormTab
}

interface PickImageFilesOptions {
  accept?: string
  capture?: string
}

interface NumericInputOptions {
  allowDecimal?: boolean
  allowNegative?: boolean
}

const FilePickerModal = lazyRetry(async () => ({
  default: (await import('../../files/FilePickerModal')).default as ComponentType<FilePickerModalProps>,
}), 'product-form-file-picker-modal')

type ContactsTransportModule = typeof import('../../../api/contactsTransport.ts')
type ProductImageUploadTransportModule = typeof import('../../../api/productImageUploadTransport.ts')

let contactsTransportModulePromise: Promise<ContactsTransportModule> | null = null
let productImageUploadTransportModulePromise: Promise<ProductImageUploadTransportModule> | null = null

function loadContactsTransportModule(): Promise<ContactsTransportModule> {
  if (!contactsTransportModulePromise) contactsTransportModulePromise = import('../../../api/contactsTransport.ts')
  return contactsTransportModulePromise
}

function loadProductImageUploadTransportModule(): Promise<ProductImageUploadTransportModule> {
  if (!productImageUploadTransportModulePromise) {
    productImageUploadTransportModulePromise = import('../../../api/productImageUploadTransport.ts')
  }
  return productImageUploadTransportModulePromise
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function hasAllPermission(value: unknown): boolean {
  if (value && typeof value === 'object') return (value as { all?: unknown }).all === true
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const parsed = JSON.parse(value) as { all?: unknown }
    return parsed?.all === true
  } catch {
    return false
  }
}

function isAdminProductUser(user?: ProductUser | null): boolean {
  return String(user?.username || '').trim().toLowerCase() === 'admin'
    || String(user?.role_code || '').trim().toLowerCase() === 'admin'
    || hasAllPermission(user?.permissions)
    || hasAllPermission(user?.role_permissions)
}

function normalizeGallery(product?: ProductFormState | null, limit = MAX_PRODUCT_GALLERY_IMAGES): string[] {
  const source = Array.isArray(product?.image_gallery)
    ? product.image_gallery
    : (product?.image_path ? [product.image_path] : [])
  const seen = new Set<string>()
  const list: string[] = []
  for (const entry of source) {
    const value = String(entry || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    list.push(value)
    if (list.length >= limit) break
  }
  return list
}

// Mirrors cloudflare/src/lib/importImageMatch.ts's buildImageDisplayName --
// same "ProductName" / "ProductName_2" convention, kept as a small local
// copy since that module lives in the Workers backend, not a package
// shared with the frontend. A single image for a product gets the plain
// product name; two or more get a 1-based "_N" suffix so multiple photos
// of the same product don't collide on one name.
//
// Root cause of "image renaming missing _1/_2 suffixes": uploadPickedImages
// used to pass the exact same `productName` for every file in a multi-file
// selection, so a 3-photo album for "Coca Cola" tried to name every file
// "Coca Cola" -- only the backend's opaque timestamp+random storage suffix
// kept them from physically colliding, and none of them got a human-
// readable _1/_2/_3 to tell them apart. Now each upload (including ones
// added later to a product that already has photos) gets its own position
// counted against the gallery's final size.
function buildGalleryImageName(productName: string, position: number, total: number): string {
  const base = String(productName || '').trim() || 'product'
  return total > 1 ? `${base}_${position}` : base
}

function editablePrice(value: unknown, fallback = 0): string {
  if (value === '' || value === null || typeof value === 'undefined') return formatPriceNumber(fallback)
  return formatPriceNumber(value)
}

function pickImageFiles(maxCount = 1, options: PickImageFilesOptions = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = options.accept || 'image/*'
    if (options.capture) input.setAttribute('capture', options.capture)
    input.multiple = maxCount > 1
    // Visually hidden but attached to the DOM -- some mobile browsers/
    // in-app webviews only reliably fire `change` on an input that's
    // actually in the document, not a detached one.
    input.style.position = 'fixed'
    input.style.top = '-1000px'
    input.style.left = '-1000px'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'

    let settled = false
    let cancelCheckTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = (): void => {
      window.removeEventListener('focus', onWindowFocus)
      if (cancelCheckTimer) clearTimeout(cancelCheckTimer)
      input.remove()
    }
    const settle = (files: File[]): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(files)
    }

    input.onchange = () => {
      settle(Array.from(input.files || []).slice(0, maxCount))
    }

    // The OS file picker gives no reliable "cancelled" event on every
    // platform. Detecting the window regaining focus after the dialog
    // closes -- with a short delay so a real `change` event (which fires
    // first on every browser tested) gets a chance to settle this first --
    // is the standard fallback so a dismissed dialog doesn't leave this
    // promise (and the caller's in-flight guard) hanging forever.
    const onWindowFocus = (): void => {
      cancelCheckTimer = setTimeout(() => settle(Array.from(input.files || []).slice(0, maxCount)), 300)
    }
    window.addEventListener('focus', onWindowFocus)

    document.body.appendChild(input)
    input.click()
  })
}

export default function ProductForm({
  product,
  categories,
  units,
  branches,
  brandOptions = [],
  groupCandidates = [],
  onSave,
  onDelete,
  onClose,
  t,
  usdSymbol,
  khrSymbol,
  exchangeRate,
  user,
  initialTab = 'basic',
}: ProductFormProps) {
  const defaultBranchId = branches.find((branch) => branch.is_default)?.id?.toString()
    || branches[0]?.id?.toString()
    || ''
  const currentProductId = Number(product?.id || 0)
  const imageLimit = isAdminProductUser(user) ? ADMIN_MAX_PRODUCT_GALLERY_IMAGES : MAX_PRODUCT_GALLERY_IMAGES

  const initialForm = useMemo<ProductFormState>(() => {
    if (product) {
      return { ...product }
    }
    return {
      name: '',
      sku: '',
      barcode: '',
      category: '',
      brand: '',
      description: '',
      selling_price_usd: 0,
      selling_price_khr: 0,
      special_price_usd: 0,
      special_price_khr: 0,
      discount_enabled: 0,
      discount_type: 'percent',
      discount_percent: 0,
      discount_amount_usd: 0,
      discount_amount_khr: 0,
      discount_label: '',
      discount_badge_color: '#e11d48',
      discount_starts_at: '',
      discount_ends_at: '',
      cost_price_usd: 0,
      cost_price_khr: 0,
      stock_quantity: 0,
      low_stock_threshold: 10,
      out_of_stock_threshold: 0,
      expiry_date: '',
      expiry_alert_days: 30,
      unit: units[0]?.name || 'pcs',
      supplier: '',
      tag_label: '',
      image_path: '',
      image_gallery: [],
      branch_id: defaultBranchId,
      is_group: 0,
      parent_id: null,
    }
  }, [product, units, defaultBranchId])

  const availableGroupParents = useMemo(() => (
    (Array.isArray(groupCandidates) ? groupCandidates : [])
      .filter((candidate) => Number(candidate?.id || 0) !== currentProductId)
      .filter((candidate) => !Number(candidate?.parent_id || 0))
      .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), undefined, { sensitivity: 'base' }))
  ), [currentProductId, groupCandidates])

  const [form, setForm] = useState<ProductFormState>(initialForm)
  // Always retain/display a pre-existing admin gallery. The ordinary-user
  // limit controls additions; it must not truncate positions 4-5 merely
  // because someone edited an unrelated product field.
  const [imageList, setImageList] = useState(() => normalizeGallery(initialForm, ADMIN_MAX_PRODUCT_GALLERY_IMAGES))
  const [activeTab, setActiveTab] = useState<ProductFormTab>(initialTab || 'basic')
  const lastTabResetKeyRef = useRef<string>(`${currentProductId}:${initialTab || 'basic'}`)
  const [supplierList, setSupplierList] = useState<SupplierOption[]>([])
  const [supplierDrop, setSupplierDrop] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [scannerField, setScannerField] = useState<ScannerField | ''>('')
  const [scannerLaunchingField, setScannerLaunchingField] = useState<ScannerField | ''>('')
  const [saving, setSaving] = useState(false)
  const [imageUploading, setImageUploading] = useState(false)
  // Which gallery tile is currently being drag-reordered, if any (Part 242) --
  // see reorderImage/moveImage above.
  const [dragImageIndex, setDragImageIndex] = useState<number | null>(null)
  const supplierRequestRef = useRef(0)
  const nameInputRef = useRef<HTMLInputElement>(null)
  // Locked-name-of-a-grouped-product feature (this session). isGroupedProduct
  // is computed off the SAVED name this form loaded with (initialForm.name),
  // not the live-edited form.name -- the lock question is "does this
  // product currently belong to a name-based group", which is a fact about
  // what's already saved, not about whatever the person is mid-typing.
  // Uses groupCandidates (the same list availableGroupParents above already
  // filters) rather than a separate fetch: any OTHER product in that list
  // sharing this product's exact name (case/whitespace-insensitive) means
  // the app's own name-based grouping (see routes/products.ts and
  // productGrouping.ts's resolveGroupKey) already treats this row as part
  // of a group. A brand-new product (no id yet) is never "grouped".
  const isGroupedProduct = useMemo(() => {
    const name = String(initialForm.name || '').trim().toLowerCase()
    if (!name || !currentProductId) return false
    return (Array.isArray(groupCandidates) ? groupCandidates : [])
      .some((candidate) => Number(candidate?.id || 0) !== currentProductId
        && String(candidate?.name || '').trim().toLowerCase() === name)
  }, [groupCandidates, initialForm.name, currentProductId])
  // A group is ONE product to the customer, so it carries ONE set of photos.
  // The owner is the lowest-id row sharing the name -- the same "first row
  // wins" tie-break the identity rule uses everywhere else, so every surface
  // independently agrees on which row that is without needing a stored flag.
  //
  // Child rows therefore do not get their own uploader: the Choose File /
  // Take Photo / Open Files controls are hidden for them and the group's
  // images are managed from the group title instead (Products.tsx's
  // renderGroupActions "Add image", which opens THIS form for the lead).
  // Without that, three sibling rows could each hold three different photos
  // and the group header would show whichever row happened to be lead --
  // the other six silently invisible.
  //
  // Renaming a child out of the group makes it a standalone product, at
  // which point this recomputes and it regains its own uploader. That falls
  // out of name-based grouping rather than needing its own code path, which
  // is exactly why the name is the group axis.
  const groupImageOwnerId = useMemo(() => {
    if (!isGroupedProduct || !currentProductId) return null
    const name = String(initialForm.name || '').trim().toLowerCase()
    const ids = (Array.isArray(groupCandidates) ? groupCandidates : [])
      .filter((candidate) => String(candidate?.name || '').trim().toLowerCase() === name)
      .map((candidate) => Number(candidate?.id || 0))
      .filter((id) => id > 0)
    ids.push(currentProductId)
    return Math.min(...ids)
  }, [groupCandidates, initialForm.name, currentProductId, isGroupedProduct])
  // Which rows share this product's name, oldest first. This is the GROUP --
  // the thing the Products list draws a header for and pages as one unit.
  const groupMembers = useMemo(() => {
    const name = String(initialForm.name || '').trim().toLowerCase()
    if (!name || !currentProductId) return []
    const others = (Array.isArray(groupCandidates) ? groupCandidates : [])
      .filter((candidate) => String(candidate?.name || '').trim().toLowerCase() === name)
      .map((candidate) => Number(candidate?.id || 0))
      .filter((id) => id > 0 && id !== currentProductId)
    return [...others, currentProductId].sort((a, b) => a - b)
  }, [groupCandidates, initialForm.name, currentProductId])
  const groupPosition = groupMembers.indexOf(currentProductId ?? -1) + 1

  // True when this row is a CHILD of a name group: the group owns the photos
  // and this row is not the owner.
  const imagesOwnedByGroupLead = groupImageOwnerId != null && groupImageOwnerId !== currentProductId

  // Unlocked only for this open/edit session -- resets on every tab-reset
  // (see the effect below), never persisted, so reopening the form always
  // starts locked again for a still-grouped product.
  const [nameUnlocked, setNameUnlocked] = useState(false)
  const [nameUnlockConfirmOpen, setNameUnlockConfirmOpen] = useState(false)
  const nameLocked = isGroupedProduct && !nameUnlocked
  const aliveRef = useRef(true)
  const imageUploadInFlightRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const isKhmer = /[\u1780-\u17FF]/.test(t('cancel') || '')

  const tr = (key: string, fallbackEn: string, fallbackKm = fallbackEn): string => {
    const value = t(key)
    if (value && value !== key) return value
    return isKhmer ? fallbackKm : fallbackEn
  }

  const categoryOptions = useMemo<AppSelectOption[]>(() => {
    const currentCategory = String(form.category || '')
    const options: AppSelectOption[] = [
      { value: '', label: tr('category', 'Category', 'ប្រភេទ') },
      ...categories.map((category) => ({ value: category.name, label: category.name })),
    ]
    if (currentCategory && !options.some((option) => String(option.value) === currentCategory)) {
      options.splice(1, 0, { value: currentCategory, label: currentCategory })
    }
    return options
  }, [categories, form.category])

  const unitOptions = useMemo<AppSelectOption[]>(() => {
    const currentUnit = String(form.unit || 'pcs')
    const options = units.map((unit) => ({ value: unit.name, label: unit.name }))
    if (currentUnit && !options.some((option) => String(option.value) === currentUnit)) {
      return [{ value: currentUnit, label: currentUnit }, ...options]
    }
    return options
  }, [form.unit, units])

  const parentGroupOptions = useMemo<AppSelectOption[]>(() => {
    const currentParentId = form.parent_id ? String(form.parent_id) : ''
    const options: AppSelectOption[] = [
      { value: '', label: tr('group_parent_none', 'No group parent (standalone or root item)', 'គ្មានក្រុមមេ (ឯករាជ្យ ឬ ជាឫសក្រុម)') },
      ...availableGroupParents.map((candidate) => ({
        value: String(candidate.id || ''),
        label: candidate.name || tr('unnamed_group', 'Unnamed group', 'ក្រុមគ្មានឈ្មោះ'),
      })),
    ]
    if (currentParentId && !options.some((option) => String(option.value) === currentParentId)) {
      options.splice(1, 0, { value: currentParentId, label: tr('current_group_parent', 'Current group parent', 'ក្រុមមេបច្ចុប្បន្ន') })
    }
    return options
  }, [availableGroupParents, form.parent_id])

  const initialBranchOptions = useMemo<AppSelectOption[]>(() => {
    const currentBranchId = form.branch_id ? String(form.branch_id) : ''
    const options = branches.map((branch) => ({
      value: branch.id,
      label: branch.is_default ? `${branch.name} (${tr('default_label', 'default', 'លំនាំដើម')})` : branch.name,
    }))
    if (currentBranchId && !options.some((option) => String(option.value) === currentBranchId)) {
      return [{ value: currentBranchId, label: tr('current_branch', 'Current branch', 'សាខាបច្ចុប្បន្ន') }, ...options]
    }
    return options
  }, [branches, form.branch_id])

  useEffect(() => {
    setForm({
      ...initialForm,
      selling_price_usd: editablePrice(initialForm.selling_price_usd),
      selling_price_khr: editablePrice(initialForm.selling_price_khr),
      // VIP price is its OWN optional field. It must NOT default to the
      // selling price: the API was omitting these two columns, so the
      // `?? selling` fallback silently loaded the selling price into the
      // VIP field, and the save below then wrote it back -- overwriting a
      // real VIP price (e.g. 8) with the selling price (12) on every edit.
      // A product with no VIP price loads blank/0 and stays that way.
      special_price_usd: editablePrice(initialForm.special_price_usd),
      special_price_khr: editablePrice(initialForm.special_price_khr),
      discount_enabled: Number(initialForm.discount_enabled || 0),
      discount_type: initialForm.discount_type || 'percent',
      discount_percent: editablePrice(initialForm.discount_percent || 0),
      discount_amount_usd: editablePrice(initialForm.discount_amount_usd || 0),
      discount_amount_khr: editablePrice(initialForm.discount_amount_khr || 0),
      discount_label: initialForm.discount_label || '',
      discount_badge_color: initialForm.discount_badge_color || '#e11d48',
      discount_starts_at: initialForm.discount_starts_at || '',
      discount_ends_at: initialForm.discount_ends_at || '',
      expiry_date: initialForm.expiry_date || '',
      expiry_alert_days: editablePrice(initialForm.expiry_alert_days ?? 30),
      cost_price_usd: editablePrice(initialForm.cost_price_usd),
      cost_price_khr: editablePrice(initialForm.cost_price_khr),
      parent_id: initialForm.parent_id ? Number(initialForm.parent_id) : null,
    })
    setImageList(normalizeGallery(initialForm, ADMIN_MAX_PRODUCT_GALLERY_IMAGES))
    // Defense-in-depth on top of the Products.tsx memoization fix (see
    // that file's comment on `modalProduct`): only reset the active tab
    // when this is genuinely a different product (or the caller asked
    // for a specific initialTab again), not on every re-run of this
    // effect. Without this guard, any future caller that passes an
    // unstable `product`/`initialForm` reference would reintroduce the
    // same "silently snaps back to Basic Info" bug this session fixed.
    const resetKey = `${currentProductId}:${initialTab || 'basic'}`
    if (lastTabResetKeyRef.current !== resetKey) {
      lastTabResetKeyRef.current = resetKey
      setActiveTab(initialTab || 'basic')
      setNameUnlocked(false)
      setNameUnlockConfirmOpen(false)
    }
  }, [initialForm, initialTab, currentProductId, imageLimit])

  useEffect(() => () => {
    aliveRef.current = false
    invalidateTrackedRequest(supplierRequestRef)
  }, [])

  useEffect(() => {
    const requestId = beginTrackedRequest(supplierRequestRef)
    async function loadSuppliers() {
      try {
        const data = await withLoaderTimeout(
          // fields=names: the autocomplete only needs names, and the
          // name-only list is the one suppliers read every role may call
          // (Part 383 R2 -- the full list needs contacts_suppliers).
          async () => (await loadContactsTransportModule()).getSuppliers({ fields: 'names' }),
          'Product suppliers',
          PRODUCT_SUPPLIERS_TIMEOUT_MS,
        )
        if (!aliveRef.current || !isTrackedRequestCurrent(supplierRequestRef, requestId)) return
        setSupplierList(Array.isArray(data) ? data as SupplierOption[] : [])
      } catch {
        if (!aliveRef.current || !isTrackedRequestCurrent(supplierRequestRef, requestId)) return
      }
    }
    loadSuppliers()
    return () => {
      invalidateTrackedRequest(supplierRequestRef)
    }
  }, [])

  useEffect(() => {
    if (!product && !form.branch_id && defaultBranchId) {
      setForm((current) => ({ ...current, branch_id: defaultBranchId }))
    }
  }, [product, form.branch_id, defaultBranchId])

  // N2: any field edit marks this open form dirty; the registration below
  // makes page navigation stop and ask instead of silently dropping it.
  const formDirtyRef = useRef(false)
  function setField(key: keyof ProductFormState, value: unknown): void {
    formDirtyRef.current = true
    setForm((current) => ({ ...current, [key]: value }))
  }

  // Part 388 "Canva-level" persistence: the in-progress form autosaves to
  // localStorage (debounced) and comes back after a crash, reload, or
  // accidental close. The draft is cleared on a successful save and on an
  // explicit Discard & Leave; a draft older than the product's own
  // updated_at is dropped rather than resurrecting stale edits over newer
  // server data.
  const draftKey = `bos_draft_product_${product?.id ?? 'new'}`

  // D6 rename gate: a promise the save flow awaits while the shared
  // before->after dialog asks what happens to attached rows.
  const [renameRequest, setRenameRequest] = useState<RenameCascadeRequest | null>(null)
  const renameResolveRef = useRef<((choice: RenameCascadeChoice) => void) | null>(null)
  const askRenameChoice = (request: RenameCascadeRequest) => new Promise<RenameCascadeChoice>((resolve) => {
    renameResolveRef.current = resolve
    setRenameRequest(request)
  })
  const handleRenameChoice = (choice: RenameCascadeChoice) => {
    setRenameRequest(null)
    const resolve = renameResolveRef.current
    renameResolveRef.current = null
    resolve?.(choice)
  }

  // F1 (Part 408): CREATE mode live-searches the catalog while the name/
  // barcode is typed and speaks the identity rule BEFORE create -- the
  // structured verdict modal offers go-back / add-as-child / proceed-as-new
  // (as-new withheld for an exact twin, which the backend refuses anyway).
  const isCreateMode = !product?.id
  const [createMatches, setCreateMatches] = useState<CreateMatchCandidate[]>([])
  const [createVerdictOpen, setCreateVerdictOpen] = useState(false)
  const createVerdictResolveRef = useRef<((choice: 'back' | 'child' | 'new') => void) | null>(null)
  const createMatchSeqRef = useRef(0)
  const createMatchAckRef = useRef('')
  const createVerdict: CreateMatchVerdict = useMemo(
    () => classifyCreateMatches({ name: form.name, barcode: form.barcode, selling_price_usd: parseNumericInput(form.selling_price_usd) }, createMatches),
    [form.name, form.barcode, form.selling_price_usd, createMatches],
  )
  useEffect(() => {
    if (!isCreateMode) return
    const name = String(form.name || '').trim()
    const barcode = String(form.barcode || '').trim()
    if (name.length < 2 && !barcode) { setCreateMatches([]); return }
    const seq = ++createMatchSeqRef.current
    const timer = window.setTimeout(async () => {
      try {
        const queries = [name, barcode].filter((query) => query.length >= 2)
        const results: CreateMatchCandidate[] = []
        for (const query of queries) {
          const payload = await searchProductsForMatch({ query, pageSize: 10 }) as { items?: CreateMatchCandidate[] }
          if (Array.isArray(payload?.items)) results.push(...payload.items)
        }
        if (seq !== createMatchSeqRef.current) return
        const seen = new Set<string>()
        setCreateMatches(results.filter((row) => {
          const key = String(row.id)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }))
      } catch { /* live match is advisory -- a failed search never blocks typing */ }
    }, 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreateMode, form.name, form.barcode])
  const askCreateVerdict = () => new Promise<'back' | 'child' | 'new'>((resolve) => {
    createVerdictResolveRef.current = resolve
    setCreateVerdictOpen(true)
  })
  const resolveCreateVerdict = (choice: 'back' | 'child' | 'new') => {
    setCreateVerdictOpen(false)
    const resolve = createVerdictResolveRef.current
    createVerdictResolveRef.current = null
    resolve?.(choice)
  }

  useEffect(() => {
    formDirtyRef.current = false
    try {
      const raw = localStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw) as { at?: number; form?: Partial<ProductFormState> }
        const serverEditedAt = (product as Record<string, unknown> | null)?.updated_at ? Date.parse(String((product as Record<string, unknown>).updated_at)) : 0
        if (draft?.form && (!serverEditedAt || (draft.at || 0) > serverEditedAt)) {
          setForm((current) => ({ ...current, ...draft.form }))
          formDirtyRef.current = true
          // (no notify prop here -- the restored values themselves are the signal)
        } else {
          localStorage.removeItem(draftKey)
        }
      }
    } catch { /* draft storage unavailable -- form still works */ }
    const productLabel = String(product?.name || form.name || '').trim()
    return registerDirtyWork({
      key: `product-form-${product?.id ?? 'new'}`,
      pageId: 'products',
      label: `${t('product_form') || 'Product form'}${productLabel ? ` — ${productLabel}` : ''}`,
      isDirty: () => formDirtyRef.current,
      // No save hook on purpose: this form's save runs required-field and
      // identity validation -- auto-submitting from a navigation prompt
      // would surface those errors in a page the user is trying to leave.
      // The guard offers Discard & Leave / Stay for this entry.
      discard: () => { try { localStorage.removeItem(draftKey) } catch { /* fine */ } },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id])

  useEffect(() => {
    if (!formDirtyRef.current) return
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ at: Date.now(), form })) } catch { /* full/blocked */ }
    }, 800)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, draftKey])

  function setNumericField(key: keyof ProductFormState, value: unknown, options?: NumericInputOptions): void {
    setField(key, sanitizeNumericInput(value, options))
  }

  async function addImages(): Promise<void> {
    if (saving || imageUploading) return
    await uploadPickedImages({})
  }

  async function addPhoto(): Promise<void> {
    if (saving || imageUploading) return
    await uploadPickedImages({ capture: 'environment' })
  }

  async function uploadPickedImages(options: PickImageFilesOptions = {}): Promise<void> {
    if (imageUploading || imageUploadInFlightRef.current) return
    imageUploadInFlightRef.current = true
    try {
      const remaining = Math.max(0, imageLimit - imageList.length)
      if (!remaining) {
        imageUploadInFlightRef.current = false
        return
      }
      const files = await pickImageFiles(remaining, options)
      if (!files.length) {
        imageUploadInFlightRef.current = false
        return
      }
      setImageUploading(true)
      const stagedImages: string[] = []
      const productNameForNaming = String(form.name || '').trim()
      // Position/total are computed against the gallery's final size (existing
      // images already on the product + every file in this batch), not just
      // this batch alone -- see buildGalleryImageName above.
      const existingCount = imageList.length
      const totalAfterBatch = Math.min(imageLimit, existingCount + files.length)
      for (const [index, file] of files.entries()) {
        const uploaded = await withLoaderTimeout(
          async () => (await loadProductImageUploadTransportModule()).uploadProductImage({
            productId: currentProductId || undefined,
            file,
            fileName: file.name || 'product.jpg',
            productName: productNameForNaming
              ? buildGalleryImageName(productNameForNaming, existingCount + index + 1, totalAfterBatch)
              : undefined,
          }) as Promise<ProductImageUploadResult | undefined>,
          'Upload product form image',
          PRODUCT_FORM_IMAGE_UPLOAD_TIMEOUT_MS,
        )
        const rawPath = uploaded?.public_path || uploaded?.path || uploaded?.asset?.public_path || uploaded?.data?.path || ''
        const publicPath = buildCacheBustedMediaPath(rawPath, uploaded?.cache_version || uploaded?.asset?.updated_at || uploaded?.asset?.created_at || '')
        if (publicPath) stagedImages.push(publicPath)
      }
      setImageList((current) => {
        const next = [...current]
        stagedImages.forEach((url) => {
          if (!next.includes(url) && next.length < imageLimit) next.push(url)
        })
        return next
      })
    } catch (error) {
      alert(getErrorMessage(error, tr('image_upload_failed', 'Image upload failed', 'ការបង្ហោះរូបភាពបានបរាជ័យ')))
    } finally {
      imageUploadInFlightRef.current = false
      setImageUploading(false)
    }
  }

  function removeImage(index: number): void {
    setImageList((current) => current.filter((_, idx) => idx !== index))
  }

  // Drag-to-reorder for the gallery grid (Part 242), mirrored off the same
  // HTML5 drag pattern FieldOrderManager.tsx already uses for receipt
  // section ordering: dragImageIndex tracks the tile being dragged,
  // onDragOver live-reorders as the pointer crosses tile boundaries, and
  // moveImage below gives touch/keyboard users (HTML5 drag doesn't fire on
  // most mobile touchscreens) an equivalent left/right-arrow way to do the
  // same reorder without a mouse.
  function reorderImage(fromIndex: number, toIndex: number): void {
    setImageList((current) => {
      if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }

  function moveImage(index: number, direction: -1 | 1): void {
    reorderImage(index, index + direction)
  }

  function setPrimaryImage(index: number): void {
    setImageList((current) => {
      if (index < 0 || index >= current.length) return current
      const next = [...current]
      const [primary] = next.splice(index, 1)
      next.unshift(primary)
      return next
    })
  }

  async function saveForm(): Promise<void> {
    // imageUploading guard mirrors the Save button's own disabled state --
    // belt-and-suspenders in case saveForm is ever invoked another way
    // (e.g. a future keyboard-submit path) that doesn't go through the
    // disabled button. See the button's own comment for the bug this
    // closes: saving mid-upload used the stale pre-upload imageList.
    if (saving || saveInFlightRef.current || imageUploading) return
    if (!String(form.name || '').trim()) {
      alert(tr('name_required_alert', 'Name is required', 'ត្រូវការឈ្មោះ'))
      return
    }
    // P7-b: a barcode reading as scientific notation is an Excel export
    // artifact, never a real code -- refuse it at this door with the same
    // rule the import planner applies (productImportPlanner
    // barcode_scientific_notation), so the catalog can't take one in
    // through manual create/edit either. The server enforces it too.
    if (/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(String(form.barcode || '').trim())) {
      alert(tr(
        'barcode_scientific_notation_alert',
        'This barcode looks like scientific notation (an Excel export artifact). Edit it or clear it — it cannot be saved as-is.',
        'បាកូដនេះមើលទៅដូចជាទម្រង់វិទ្យាសាស្ត្រ (កំហុសពីការនាំចេញ Excel)។ កែ ឬលុបវាចេញ — មិនអាចរក្សាទុកបែបនេះបានទេ។',
      ))
      return
    }
    // F1: the page-by-page confirm -- a matching name/barcode stops the
    // create ONCE per exact typed identity and asks. 'child' adopts the
    // matched group's canonical spelling so the new row joins the group
    // instead of forking a near-miss; 'new' proceeds deliberately (never
    // offered for an exact twin); 'back' returns to editing.
    if (isCreateMode && createVerdict.kind) {
      const ackKey = `${String(form.name || '').trim().toLowerCase()}|${String(form.barcode || '').trim()}`
      if (createMatchAckRef.current !== ackKey) {
        const choice = await askCreateVerdict()
        if (choice === 'back') return
        if (choice === 'child' && createVerdict.canonicalName) {
          setField('name', createVerdict.canonicalName)
          form.name = createVerdict.canonicalName
        }
        createMatchAckRef.current = ackKey
      }
    }
    if (!product && branches.length > 0 && !form.branch_id) {
      alert(tr('branch_required_alert', 'Please choose a branch for this product.', 'សូមជ្រើសរើសសាខាសម្រាប់ផលិតផលនេះ។'))
      return
    }
    saveInFlightRef.current = true
    const payload: ProductSavePayload = {
      ...form,
      selling_price_usd: normalizePriceValue(parseNumericInput(form.selling_price_usd)),
      selling_price_khr: normalizePriceValue(parseNumericInput(form.selling_price_khr)),
      // No `?? selling` fallback -- see the load above. Whatever is in the
      // VIP field (0 if the user left it blank) is what gets saved, so an
      // untouched VIP price is never clobbered with the selling price.
      special_price_usd: normalizePriceValue(parseNumericInput(form.special_price_usd)),
      special_price_khr: normalizePriceValue(parseNumericInput(form.special_price_khr)),
      discount_enabled: form.discount_enabled ? 1 : 0,
      discount_type: form.discount_type === 'fixed' ? 'fixed' : 'percent',
      discount_percent: normalizePriceValue(parseNumericInput(form.discount_percent)),
      discount_amount_usd: normalizePriceValue(parseNumericInput(form.discount_amount_usd)),
      discount_amount_khr: normalizePriceValue(parseNumericInput(form.discount_amount_khr)),
      discount_label: String(form.discount_label || '').trim(),
      discount_badge_color: /^#[0-9a-f]{6}$/i.test(String(form.discount_badge_color || '')) ? String(form.discount_badge_color) : '#e11d48',
      discount_starts_at: form.discount_starts_at || null,
      discount_ends_at: form.discount_ends_at || null,
      cost_price_usd: normalizePriceValue(parseNumericInput(form.cost_price_usd)),
      cost_price_khr: normalizePriceValue(parseNumericInput(form.cost_price_khr)),
      stock_quantity: parseNumericInput(form.stock_quantity),
      low_stock_threshold: parseNumericInput(form.low_stock_threshold, 10),
      out_of_stock_threshold: parseNumericInput(form.out_of_stock_threshold),
      expiry_date: form.expiry_date || null,
      expiry_alert_days: parseNumericInput(form.expiry_alert_days, 30),
      // Positions 4-5 may be an existing admin-created gallery. They are
      // preserved on ordinary edits; all add paths above still stop at the
      // caller's 3/5 action limit.
      image_gallery: imageList.slice(0, ADMIN_MAX_PRODUCT_GALLERY_IMAGES),
      image_path: imageList[0] || '',
      is_group: form.parent_id ? 0 : (Number(form.is_group) ? 1 : 0),
      parent_id: form.parent_id ? Number(form.parent_id) : null,
    }
    // D6: renaming an EXISTING product that shares its name with siblings
    // asks whether the whole group carries (9.1's regroup) or only this
    // row splits off; a brand change over a multi-product brand asks
    // whether the brand renames everywhere. Preview counts come from the
    // server; if the preview endpoint is unreachable the save behaves
    // exactly as before (only this row).
    if (product?.id) {
      const oldName = String(product.name || '').trim()
      const newName = String(payload.name || '').trim()
      if (oldName && newName && oldName.toLowerCase() !== newName.toLowerCase()) {
        try {
          const impact = await getRenameImpact('product_name', oldName, newName)
          if (impact.group_rows > 1) {
            const choice = await askRenameChoice({ kind: 'product_name', from: oldName, to: newName, impact, choices: ['carry', 'only'] })
            if (choice === 'cancel') { saveInFlightRef.current = false; return }
            if (choice === 'carry') (payload as unknown as Record<string, unknown>).__rename_scope = 'group'
          }
        } catch { /* preview unavailable -- old only-this-row behavior */ }
      }
      const oldBrand = String((product as Record<string, unknown>).brand || '').trim()
      const newBrand = String(payload.brand || '').trim()
      if (oldBrand && newBrand && oldBrand.toLowerCase() !== newBrand.toLowerCase()) {
        try {
          const impact = await getRenameImpact('brand', oldBrand, newBrand)
          if (impact.products_primary + impact.products_secondary > 1) {
            const choice = await askRenameChoice({ kind: 'brand', from: oldBrand, to: newBrand, impact, choices: ['carry', 'only'] })
            if (choice === 'cancel') { saveInFlightRef.current = false; return }
            if (choice === 'carry') await renameBrandEverywhere(oldBrand, newBrand)
          }
        } catch { /* preview unavailable -- brand changes on this row only */ }
      }
    }
    setSaving(true)
    try {
      await Promise.resolve(onSave(payload))
      // Saved for real -- the autosaved draft is now history (Part 388).
      formDirtyRef.current = false
      try { localStorage.removeItem(draftKey) } catch { /* fine */ }
    } catch (error) {
      alert(getErrorMessage(error, tr('failed', 'Failed', 'បរាជ័យ')))
    } finally {
      saveInFlightRef.current = false
      setSaving(false)
    }
  }

  async function openScanner(field: ScannerField): Promise<void> {
    if (saving || scannerLaunchingField) return
    setScannerField(field)
  }

  function closeScanner(): void {
    setScannerField('')
  }

  function applyScannedValue(value: string): void {
    const nextValue = String(value || '').trim()
    if (!nextValue || !scannerField) return
    setField(scannerField, nextValue)
    closeScanner()
  }

  const scanningLabel = tr('scanner_state_starting', 'Opening camera...', 'កំពុងបើកកាមេរ៉ា...')
  const scanSkuLabel = tr('scan_sku', 'Scan SKU', 'ស្កេន SKU')
  const scanBarcodeLabel = tr('scan_barcode', 'Scan barcode', 'ស្កេនបាកូដ')

  const tabs: Array<{ id: ProductFormTab; label: string }> = [
    { id: 'basic', label: tr('basic_info', 'Basic Info', 'ព័ត៌មានមូលដ្ឋាន') },
    { id: 'pricing', label: tr('pricing', 'Pricing', 'តម្លៃ') },
    { id: 'stock', label: tr('stock', 'Stock', 'ស្តុក') },
    { id: 'expiry', label: tr('expiry', 'Expiry', 'ផុតកំណត់') },
  ]

  const supplierMatches = form.supplier
    ? supplierList.filter((supplier) => String(supplier.name || '').toLowerCase().includes(String(form.supplier || '').toLowerCase()))
    : []

  return (
    <Modal title={product ? `${tr('edit_product', 'Edit Product', 'កែប្រែផលិតផល')}: ${product.name}` : tr('add_product', 'Add Product', 'បន្ថែមផលិតផល')} onClose={onClose} wide>
      <div className="mb-5 -mx-5 border-b border-gray-200 px-5 dark:border-gray-700">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'basic' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{tr('upload_image', 'Upload Image', 'បង្ហោះរូបភាព')}</p>
              {imagesOwnedByGroupLead ? null : (
                <p className="text-xs text-gray-400">
                  {imageList.length > imageLimit ? `${imageList.length} stored · add limit ${imageLimit}` : `${imageList.length}/${imageLimit}`}
                </p>
              )}
            </div>
            {imagesOwnedByGroupLead ? (
              /* Child row of a name group: the group is one product to the
                 customer and carries one set of photos, managed from the
                 group title. Explaining that here beats hiding the section
                 outright -- otherwise the uploader simply vanishes with no
                 reason given, which reads as a bug. */
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                {tr(
                  'images_managed_on_group',
                  'Photos belong to the whole group, not to this row. Add or change them from the group title above the rows. Give this row its own name to make it a separate product with its own photos.',
                  'រូបភាពជាកម្មសិទ្ធិរបស់ក្រុមទាំងមូល មិនមែនជួរនេះទេ។ សូមបន្ថែម ឬប្តូរពីចំណងជើងក្រុមខាងលើ។ ដាក់ឈ្មោះផ្សេងឲ្យជួរនេះ ដើម្បីធ្វើឲ្យវាក្លាយជាផលិតផលដាច់ដោយឡែក ដែលមានរូបភាពផ្ទាល់ខ្លួន។',
                )}
              </p>
            ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={addImages} disabled={saving || imageUploading}>
                {imageUploading ? tr('uploading', 'Uploading...', 'កំពុងបង្ហោះ...') : tr('choose_file', 'Choose File', 'ជ្រើសរើសឯកសារ')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={addPhoto} disabled={saving || imageUploading}>
                {tr('take_photo', 'Take Photo', 'ថតរូប')}
              </button>
              <button type="button" className="btn-secondary text-sm" onClick={() => setFilePickerOpen(true)} disabled={saving || imageUploading}>
                {tr('open_files', 'Open Files', 'បើកឯកសារ') || tr('files', 'Files', 'ឯកសារ')}
              </button>
            </div>
            )}
            {imageList.length && !imagesOwnedByGroupLead ? (
              <>
                {imageList.length > 1 ? (
                  <p className="text-[11px] text-gray-400">
                    {tr('drag_to_reorder_images', 'Drag to reorder, or use the arrows on each photo.', 'អូសដើម្បីរៀបលំដាប់ ឬប្រើព្រួញនៅលើរូបនីមួយៗ។')}
                  </p>
                ) : null}
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {imageList.map((image, index) => (
                    <div
                      key={`${image}-${index}`}
                      className={`group relative overflow-hidden rounded-xl border bg-slate-50 ${dragImageIndex === index ? 'border-blue-400 ring-2 ring-blue-200' : 'border-slate-200'}`}
                      draggable={imageList.length > 1}
                      onDragStart={(event: DragEvent<HTMLDivElement>) => {
                        setDragImageIndex(index)
                        event.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={(event: DragEvent<HTMLDivElement>) => {
                        event.preventDefault()
                        if (dragImageIndex == null || dragImageIndex === index) return
                        reorderImage(dragImageIndex, index)
                        setDragImageIndex(index)
                      }}
                      onDragEnd={() => setDragImageIndex(null)}
                    >
                      <img src={image} alt={`product-${index + 1}`} className="h-20 w-full object-cover sm:h-24" />
                      {index === 0 ? (
                        <span className="absolute left-1 top-1 rounded bg-blue-600/90 px-1 py-0.5 text-[9px] font-medium text-white">
                          {tr('primary', 'Primary', 'រូបសំខាន់')}
                        </span>
                      ) : null}
                      {imageList.length > 1 ? (
                        <div className="absolute right-1 top-1 flex gap-0.5">
                          <button
                            type="button"
                            className="rounded bg-black/55 p-0.5 text-white hover:bg-black/70 disabled:opacity-30"
                            onClick={() => moveImage(index, -1)}
                            disabled={index === 0}
                            title={tr('move_left', 'Move left', 'ផ្លាស់ទីទៅឆ្វេង')}
                          >
                            <ChevronLeft className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            className="rounded bg-black/55 p-0.5 text-white hover:bg-black/70 disabled:opacity-30"
                            onClick={() => moveImage(index, 1)}
                            disabled={index === imageList.length - 1}
                            title={tr('move_right', 'Move right', 'ផ្លាស់ទីទៅស្តាំ')}
                          >
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        </div>
                      ) : null}
                      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-1.5 py-1 text-[10px] text-white">
                        <button type="button" className="rounded px-1 py-0.5 hover:bg-white/20" onClick={() => setPrimaryImage(index)}>
                          {index === 0 ? tr('primary', 'Primary', 'រូបសំខាន់') : tr('set_primary', 'Set primary', 'កំណត់ជារូបសំខាន់')}
                        </button>
                        <button type="button" className="rounded px-1 py-0.5 hover:bg-white/20" onClick={() => removeImage(index)}>
                          {tr('remove', 'Remove', 'លុប')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label htmlFor="product-name" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('name')} *</label>
              <div className="relative">
                <input
                  id="product-name"
                  name="product_name"
                  ref={nameInputRef}
                  className={`input ${nameLocked ? 'cursor-pointer bg-gray-50 pr-9 dark:bg-zinc-800/60' : ''}`}
                  value={form.name || ''}
                  onChange={(event) => setField('name', event.target.value)}
                  readOnly={nameLocked}
                  onClick={() => { if (nameLocked) setNameUnlockConfirmOpen(true) }}
                  onFocus={(event) => { if (nameLocked) { event.currentTarget.blur(); setNameUnlockConfirmOpen(true) } }}
                />
                {nameLocked ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                    onClick={() => setNameUnlockConfirmOpen(true)}
                    aria-label={tr('unlock_name', 'Unlock name', 'ដោះសោឈ្មោះ')}
                    title={tr('unlock_name', 'Unlock name', 'ដោះសោឈ្មោះ')}
                  >
                    <LockIcon className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              {/* F1: while a NEW product is typed, say out loud what the
                  identity rule will do with this name/barcode -- before the
                  save button is anywhere near being pressed. */}
              {isCreateMode && createVerdict.kind ? (
                <p className={`mt-1 rounded-lg border px-2.5 py-1.5 text-xs ${createVerdict.kind === 'exact_twin'
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300'
                  : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                  {createVerdict.kind === 'exact_twin'
                    ? tr('create_match_twin_hint', 'This exact product already exists (same name and barcode) — it cannot be created twice.', 'ផលិតផលនេះមានរួចហើយ (ឈ្មោះ និងបាកូដដូចគ្នា) — មិនអាចបង្កើតម្តងទៀតបានទេ។')
                    : createVerdict.kind === 'name_match'
                      ? tr('create_match_name_hint', 'This name already exists ({n} rows) — saving adds this as a new row of that group.', 'ឈ្មោះនេះមានរួចហើយ ({n} ជួរ) — ការរក្សាទុកនឹងបន្ថែមជាជួរថ្មីនៃក្រុមនោះ។').replace('{n}', String(createVerdict.groupRows.length))
                      : tr('create_match_barcode_hint', 'This barcode is already on "{name}".', 'បាកូដនេះមាននៅលើ "{name}" រួចហើយ។').replace('{name}', createVerdict.canonicalName)}
                  {createVerdict.priceMatches ? ` · ${tr('create_match_price_hint', 'same price too', 'តម្លៃដូចគ្នាដែរ')}` : ''}
                </p>
              ) : null}
              {/* Which group this row belongs to, and where in it.
                  The "Group parent" dropdown further down only knows about
                  parent_id, which name-grouped rows do not have -- so for a
                  row that visibly sits under a group header it said "No group
                  parent", which reads as "this is standalone" and is exactly
                  wrong. Name IS the grouping, so it is stated here, next to
                  the field that determines it. */}
              {isGroupedProduct && groupMembers.length > 1 ? (
                <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  {tr('part_of_group', 'Part of the group', 'ជាផ្នែកនៃក្រុម')}
                  {' '}
                  <span className="font-semibold">{String(initialForm.name || '')}</span>
                  {' — '}
                  {tr('group_row_position', 'row {n} of {total}', 'ជួរទី {n} ក្នុងចំណោម {total}')
                    .replace('{n}', String(groupPosition))
                    .replace('{total}', String(groupMembers.length))}
                  {imagesOwnedByGroupLead
                    ? ` · ${tr('group_photos_on_first_row', 'photos live on the first row', 'រូបភាពស្ថិតនៅជួរទីមួយ')}`
                    : ` · ${tr('group_photos_on_this_row', 'this row holds the group photos', 'ជួរនេះកាន់រូបភាពរបស់ក្រុម')}`}
                </p>
              ) : null}
              {nameLocked ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {tr(
                    'name_locked_grouped_hint',
                    'Locked because this product is grouped with others by name. Click the field to unlock and rename it (this removes it from the group).',
                    'ជាប់សោ ព្រោះផលិតផលនេះស្ថិតនៅក្នុងក្រុមតាមឈ្មោះ។ ចុចលើប្រអប់ដើម្បីដោះសោ ហើយប្តូរឈ្មោះ (វានឹងដកផលិតផលនេះចេញពីក្រុម)។',
                  )}
                </p>
              ) : (isGroupedProduct ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  {tr(
                    'name_unlocked_hint',
                    'Unlocked -- saving a different name will remove this product from its current group.',
                    'បានដោះសោ -- ការរក្សាទុកឈ្មោះផ្សេង នឹងដកផលិតផលនេះចេញពីក្រុមបច្ចុប្បន្ន។',
                  )}
                </p>
              ) : null)}
            </div>
            <div>
              {/* P4: the operator's own short memory-aid chip -- free text,
                  shown next to the name in Products/POS, filterable. */}
              <label htmlFor="product-tag-label" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('tag_label') || 'Tag'}</label>
              <input
                id="product-tag-label"
                name="product_tag_label"
                className="input w-full"
                value={(form.tag_label as string) || ''}
                onChange={(event) => setField('tag_label', event.target.value)}
                placeholder={t('tag_label_placeholder') || 'Your own short label (optional)'}
                maxLength={40}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="product-sku" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('sku')}</label>
              <div className="flex gap-2">
                <input
                  id="product-sku"
                  name="product_sku"
                  className="input flex-1"
                  value={form.sku || ''}
                  onChange={(event) => setField('sku', event.target.value)}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
                  onClick={() => openScanner('sku')}
                  title={scannerLaunchingField === 'sku' ? scanningLabel : scanSkuLabel}
                  aria-label={scanSkuLabel}
                  disabled={saving || !!scannerLaunchingField}
                >
                  <ScanLine className={`h-4 w-4 ${scannerLaunchingField === 'sku' ? 'animate-pulse' : ''}`} />
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="product-category" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('category', 'Category', 'ប្រភេទ')}</label>
              <AppSelect
                id="product-category"
                name="product_category"
                value={form.category || ''}
                options={categoryOptions}
                onChange={(value) => setField('category', value)}
                ariaLabel={tr('category', 'Category', 'ប្រភេទ')}
                className="w-full"
                buttonClassName="input h-auto w-full"
              />
            </div>
            <div>
              <label htmlFor="product-brand" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('brand', 'Brand', 'ម៉ាក')}</label>
              <input
                id="product-brand"
                name="product_brand"
                className="input"
                list="product-brand-options"
                value={form.brand || ''}
                onChange={(event) => setField('brand', event.target.value)}
                placeholder={tr('brand', 'Brand', 'ម៉ាក')}
              />
              <datalist id="product-brand-options">
                {(brandOptions || []).map((brand) => (
                  <option key={brand} value={brand} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="product-unit" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('unit')}</label>
              <AppSelect
                id="product-unit"
                name="product_unit"
                value={form.unit || 'pcs'}
                options={unitOptions}
                onChange={(value) => setField('unit', value)}
                ariaLabel={t('unit') || 'Unit'}
                className="w-full"
                buttonClassName="input h-auto w-full"
              />
            </div>
            <div>
              <label htmlFor="product-parent-group" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('group_parent', 'Group Parent', 'ក្រុមមេ')}
              </label>
              <AppSelect
                id="product-parent-group"
                name="product_parent_group"
                value={form.parent_id || ''}
                options={parentGroupOptions}
                onChange={(value) => {
                  const nextParentId = value ? Number(value) : null
                  setField('parent_id', nextParentId)
                  if (nextParentId) setField('is_group', 0)
                }}
                ariaLabel={tr('group_parent', 'Group Parent', 'ក្រុមមេ')}
                className="w-full"
                buttonClassName="input h-auto w-full"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {form.parent_id
                  ? tr('group_parent_child_hint', 'This product will stay as a child variant inside the selected group.', 'ផលិតផលនេះនឹងនៅជាវ៉ារ្យ៉ង់កូននៅក្នុងក្រុមដែលបានជ្រើស។')
                  : tr('group_parent_none_hint', 'Leave blank to keep this product standalone or make it the root of a group.', 'ទុកឲ្យទទេ ដើម្បីរក្សាផលិតផលនេះឯករាជ្យ ឬជាឫសរបស់ក្រុម។')}
              </p>
            </div>
            <div className="relative">
              <label htmlFor="product-supplier" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('supplier', 'Supplier', 'អ្នកផ្គត់ផ្គង់')}</label>
              <input
                id="product-supplier"
                name="product_supplier"
                className="input"
                value={form.supplier || ''}
                onFocus={() => setSupplierDrop(true)}
                onChange={(event) => {
                  setField('supplier', event.target.value)
                  setSupplierDrop(true)
                }}
                placeholder={tr('type_or_select_supplier', 'Type or select supplier...', 'វាយឈ្មោះ ឬជ្រើសរើសអ្នកផ្គត់ផ្គង់...')}
              />
              {supplierDrop && supplierMatches.length ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-40 overflow-auto rounded-xl border border-gray-200 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-800">
                  {supplierMatches.map((supplier) => (
                    <button
                      key={supplier.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20"
                      onClick={() => {
                        setField('supplier', supplier.name)
                        setSupplierDrop(false)
                      }}
                    >
                      <span className="font-medium text-gray-800 dark:text-gray-200">{supplier.name}</span>
                      {supplier.company ? <span className="text-xs text-gray-400">{supplier.company}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="col-span-2">
              <label htmlFor="product-description" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('description')}</label>
              <textarea id="product-description" name="product_description" className="input resize-none" rows={2} value={form.description || ''} onChange={(event) => setField('description', event.target.value)} />
            </div>
            <div className="col-span-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/70">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded"
                  checked={Number(form.is_group) === 1}
                  onChange={(event) => setField('is_group', event.target.checked ? 1 : 0)}
                  disabled={!!form.parent_id}
                />
                {tr('product_group_parent', 'Treat this item as a group parent', 'កំណត់ផលិតផលនេះជា​ក្រុមមេ')}
              </label>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {form.parent_id
                  ? tr('variant_child_hint', 'This product is already a variant inside another group.', 'ផលិតផលនេះជា variant នៅក្នុងក្រុមមួយរួចហើយ។')
                  : tr('group_parent_hint', 'Group parents help you organize related variants with different costs, suppliers, or prices.', 'ក្រុមមេជួយរៀបចំ variant ដែលមានថ្លៃដើម អ្នកផ្គត់ផ្គង់ ឬតម្លៃលក់ខុសគ្នា។')}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'pricing' ? (
        <div className="space-y-5">
          {activeTab === 'pricing' ? <>
          <div className="rounded-xl border border-red-100 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/10">
            <div className="mb-3">
              <p className="text-sm font-bold text-red-700 dark:text-red-400">{t('cost')}</p>
              <p className="text-xs text-red-500 dark:text-red-500">{t('what_you_pay_supplier')}</p>
            </div>
            <DualPriceInput
              labelUsd={t('cost_in_usd_label')}
              labelKhr={t('cost_in_khr_label')}
              valueUsd={form.cost_price_usd}
              valueKhr={form.cost_price_khr}
                onUsdChange={(value) => {
                  setField('cost_price_usd', value)
                  if (!String(form.cost_price_khr ?? '').trim()) {
                    const converted = parseNumericInput(value) * exchangeRate
                    setField('cost_price_khr', value === '' ? '' : formatPriceNumber(converted))
                  }
                }}
              onKhrChange={(value) => {
                setField('cost_price_khr', value)
              }}
              usdSymbol={usdSymbol}
              khrSymbol={khrSymbol}
              exchangeRate={exchangeRate}
              t={t}
            />
          </div>

          <div className="rounded-xl border border-green-100 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/10">
            <div className="mb-3">
              <p className="text-sm font-bold text-green-700 dark:text-green-400">{tr('selling_price_to_customer', 'Selling Price', 'តម្លៃលក់')}</p>
              <p className="text-xs text-green-600 dark:text-green-500">{tr('what_customers_pay_pos', 'What customers pay at point of sale', 'តម្លៃដែលអតិថិជនបង់នៅកន្លែងលក់')}</p>
            </div>
            <DualPriceInput
              labelUsd={tr('selling_price_usd_full', 'Selling Price (USD)', 'តម្លៃលក់ (USD)')}
              labelKhr={tr('selling_price_khr_full', 'Selling Price (KHR)', 'តម្លៃលក់ (KHR)')}
              valueUsd={form.selling_price_usd}
              valueKhr={form.selling_price_khr}
                onUsdChange={(value) => {
                  setField('selling_price_usd', value)
                  if (!String(form.selling_price_khr ?? '').trim()) {
                    const converted = parseNumericInput(value) * exchangeRate
                    setField('selling_price_khr', value === '' ? '' : formatPriceNumber(converted))
                  }
                }}
              onKhrChange={(value) => setField('selling_price_khr', value)}
              usdSymbol={usdSymbol}
              khrSymbol={khrSymbol}
              exchangeRate={exchangeRate}
              t={t}
            />
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/10">
            <div className="mb-3">
              <p className="text-sm font-bold text-blue-700 dark:text-blue-400">{tr('special_price', 'Special Price', 'តម្លៃពិសេស')}</p>
              <p className="text-xs text-blue-600 dark:text-blue-500">{tr('special_price_hint', 'Internal alternate selling price for staff-only situations or quick POS selection.', 'តម្លៃលក់ជម្រើសខាងក្នុង សម្រាប់ស្ថានភាពបុគ្គលិក ឬជ្រើសរហ័សនៅ POS។')}</p>
            </div>
            <DualPriceInput
              labelUsd={tr('special_price_usd_full', 'Special Price (USD)', 'តម្លៃពិសេស (USD)')}
              labelKhr={tr('special_price_khr_full', 'Special Price (KHR)', 'តម្លៃពិសេស (KHR)')}
              valueUsd={form.special_price_usd}
              valueKhr={form.special_price_khr}
                onUsdChange={(value) => {
                  setField('special_price_usd', value)
                  if (!String(form.special_price_khr ?? '').trim()) {
                    const converted = normalizePriceValue(parseNumericInput(value) * exchangeRate)
                    setField('special_price_khr', value === '' ? '' : formatPriceNumber(converted))
                  }
                }}
              onKhrChange={(value) => setField('special_price_khr', value)}
              usdSymbol={usdSymbol}
              khrSymbol={khrSymbol}
              exchangeRate={exchangeRate}
              t={t}
            />
          </div>
          </> : null}

          <RenameCascadeModal request={renameRequest} busy={saving} t={(key, fallback) => t(key) || fallback || key} onChoose={handleRenameChoice} />
      {/* G1 (Part 391): the per-product discount editor MOVED to the
              Promotions page (user: "per-product discounts manage in
              Promotions, labels stay visible in Products"). The product
              still CARRIES its discount fields -- saving here never
              touches them -- management just lives with the other
              promotions now. */}
          <div className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-200">
            {tr('discounts_moved_note', 'Discounts are managed on the Promotions page now (Promotions › Per-product discounts).', 'ការបញ្ចុះតម្លៃត្រូវបានគ្រប់គ្រងនៅទំព័រប្រូម៉ូសិនឥឡូវនេះ (ប្រូម៉ូសិន › បញ្ចុះតម្លៃតាមផលិតផល)។')}
          </div>
          {activeTab === 'pricing' && Number(form.selling_price_usd || 0) > 0 && Number(form.cost_price_usd || 0) > 0 ? (
            <MarginCard
              costUsd={Number(form.cost_price_usd || 0)}
              sellingUsd={Number(form.selling_price_usd || 0)}
              usdSymbol={usdSymbol}
            />
          ) : null}
        </div>
      ) : null}

      {activeTab === 'stock' || activeTab === 'expiry' ? (
        <div className="space-y-4">
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${activeTab === 'stock' ? 'lg:grid-cols-3' : ''}`}>
            {activeTab === 'stock' ? <>
            <div>
              <label htmlFor="product-stock-quantity" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('stock')} ({t('quantity')})</label>
              {/* Safeguard: for an EXISTING product this field used to be a
                  plain free-editable number that saved straight through
                  Save with no reason, no per-branch breakdown, and no
                  inventory_movements trail -- silently overwriting
                  products.stock_quantity out from under the real source of
                  truth (SUM(branch_stock.quantity)) that BranchStockAdjuster
                  just below this field already keeps in sync properly
                  (reason required, batch required, tracked). Locked to
                  read-only here so the ONLY way to change an existing
                  product's quantity is through that adjuster's guarded
                  flow; still freely editable for a brand-new product
                  (no history to protect yet, no adjuster rendered until
                  after the product exists). */}
              <input
                id="product-stock-quantity"
                name="product_stock_quantity"
                className={`input${product ? ' cursor-not-allowed bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-400' : ''}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                readOnly={!!product}
                aria-readonly={!!product}
                value={form.stock_quantity ?? ''}
                onChange={(event) => { if (!product) setNumericField('stock_quantity', event.target.value) }}
              />
              {product ? (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {tr(
                    'product_stock_quantity_locked_hint',
                    'Total across all branches. Use "Adjust stock" below to change it -- a reason is required.',
                    'ចំនួនសរុបគ្រប់សាខា។ ប្រើ "លៃតម្រូវស្តុក" ខាងក្រោមដើម្បីផ្លាស់ប្តូរ — ត្រូវការហេតុផល។',
                  )}
                </p>
              ) : null}
            </div>
            </> : null}
            {activeTab === 'expiry' ? <>
            <div>
              <label htmlFor="product-low-stock-threshold" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('low_stock_threshold')}</label>
              <input
                id="product-low-stock-threshold"
                name="product_low_stock_threshold"
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.low_stock_threshold ?? ''}
                onChange={(event) => setNumericField('low_stock_threshold', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="product-out-of-stock-threshold" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('out_of_stock_threshold')}</label>
              <input
                id="product-out-of-stock-threshold"
                name="product_out_of_stock_threshold"
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.out_of_stock_threshold ?? ''}
                onChange={(event) => setNumericField('out_of_stock_threshold', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="product-expiry-date" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('product_expiry_date', 'Expiry date', 'កាលបរិច្ឆេទផុតកំណត់')}
              </label>
              <input
                id="product-expiry-date"
                name="product_expiry_date"
                className="input"
                type="date"
                value={form.expiry_date || ''}
                onChange={(event) => setField('expiry_date', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="product-expiry-alert-days" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {tr('product_expiry_alert_days', 'Expiry alert days', 'ថ្ងៃជូនដំណឹងផុតកំណត់')}
              </label>
              <input
                id="product-expiry-alert-days"
                name="product_expiry_alert_days"
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={form.expiry_alert_days ?? ''}
                onChange={(event) => setNumericField('expiry_alert_days', event.target.value)}
              />
            </div>
            </> : null}
          </div>

          {activeTab === 'stock' && !product && branches.length > 0 ? (
            <div>
              <label htmlFor="product-initial-branch" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{tr('assign_initial_branch', 'Assign Initial Stock to Branch *', 'កំណត់ស្តុកដំបូងទៅសាខា *')}</label>
              <AppSelect
                id="product-initial-branch"
                name="product_initial_branch"
                value={form.branch_id || ''}
                options={initialBranchOptions}
                onChange={(value) => setField('branch_id', value)}
                ariaLabel={tr('assign_initial_branch', 'Assign Initial Stock to Branch', 'កំណត់ស្តុកដំបូងទៅសាខា')}
                className="w-full"
                buttonClassName="input h-auto w-full"
              />
            </div>
          ) : null}

          {/* Stock tab reorg: branch (+ its reason field, both inside
              BranchStockAdjuster) first, barcode last -- moved here from
              the Basic tab's identity grid so the whole "what stock is
              this, where, why, and how do I scan it" flow reads top to
              bottom as branch -> reason -> barcode, per the Aug 21 2026
              ask to organize the Stock section that way (mirroring the
              per-branch adjustment reason work). Barcode itself is still
              a plain product-level field (not per-branch) -- only its
              position in the form moved, not its meaning or how it's
              saved/scanned. */}
          {activeTab === 'stock' && product && branches.length > 0 ? (
            <BranchStockAdjuster
              product={{
                ...product,
                id: product.id || currentProductId,
                name: product.name || '',
                cost_price_usd: parseNumericInput(product.cost_price_usd),
                cost_price_khr: parseNumericInput(product.cost_price_khr),
              }}
              branches={branches}
              user={user}
              onDone={onSave}
              t={t}
            />
          ) : null}

          {activeTab === 'stock' ? <div>
            <label htmlFor="product-barcode" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{t('barcode')}</label>
            <div className="flex gap-2">
              <input
                id="product-barcode"
                name="product_barcode"
                className="input flex-1"
                value={form.barcode || ''}
                onChange={(event) => setField('barcode', event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-600 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
                onClick={() => openScanner('barcode')}
                title={scannerLaunchingField === 'barcode' ? scanningLabel : scanBarcodeLabel}
                aria-label={scanBarcodeLabel}
                disabled={saving || !!scannerLaunchingField}
              >
                <ScanLine className={`h-4 w-4 ${scannerLaunchingField === 'barcode' ? 'animate-pulse' : ''}`} />
              </button>
            </div>
          </div> : null}
        </div>
      ) : null}

      {/* Sticky footer: pinned to the bottom of Modal.tsx's scrollable area
          (.modal-scroll) so Save/Cancel stay reachable without scrolling
          past Basic Info/Pricing/Stock on small screens. -mx-5 -mb-5
          cancels the modal's own p-5 padding so the bar spans full width
          and sits flush against the bottom edge; px-5 pb-5 pt-4 puts it
          back inside the bar. */}
      <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 flex gap-3 border-t border-gray-200 bg-white px-5 pb-5 pt-4 dark:border-gray-700 dark:bg-gray-800">
        {/* Disabled while imageUploading, not just `saving`: previously a
            fast Save click during an in-flight image upload would save the
            product with the pre-upload imageList (the just-picked file
            hadn't landed in state yet), silently orphaning the freshly
            uploaded asset in the Files library instead of linking it to
            the product -- the exact "shows uploaded but didn't connect,
            had to go re-link it via Files" bug reported. Save now can't
            fire until uploadPickedImages's setImageList has actually
            landed. */}
        <button type="button" className="btn-primary flex-1" onClick={saveForm} disabled={saving || imageUploading}>
          {saving ? (t('saving') || 'Saving...') : imageUploading ? (tr('uploading', 'Uploading...', 'កំពុងបង្ហោះ...')) : t('save')}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
          {t('cancel')}
        </button>
        {/* Delete lives in this same row now (was only reachable from the
            separate read-only detail sheet before) -- deliberately NOT
            flex-1 like Save, and icon-only with no text label, so its tap
            target stays small and off to the side rather than competing
            with Save for thumb space and inviting an accidental hit.
            onDelete already routes through Products.tsx's own
            DeleteConfirmModal (impact summary + explicit confirm), so no
            second confirmation is added here -- this button only opens
            that flow, it never deletes directly itself. */}
        {product && onDelete ? (
          <button
            type="button"
            className="btn-danger shrink-0 px-2.5"
            onClick={onDelete}
            disabled={saving}
            aria-label={t('delete') || 'Delete'}
            title={t('delete') || 'Delete'}
          >
            <Trash2Icon className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {(filePickerOpen || scannerField) ? (
        <Suspense fallback={null}>
          {filePickerOpen ? (
            <FilePickerModal
              open={filePickerOpen}
              mediaType="image"
              title={tr('choose_product_image', 'Choose product image', 'ជ្រើសរើសរូបភាពផលិតផល')}
              onClose={() => setFilePickerOpen(false)}
              onSelect={(publicPath) => setImageList((current) => current.includes(publicPath) || current.length >= imageLimit ? current : [...current, publicPath])}
            />
          ) : null}
          {scannerField ? (
            <BarcodeScannerModal
              open={!!scannerField}
              title={scannerField === 'sku' ? scanSkuLabel : scanBarcodeLabel}
              onClose={closeScanner}
              onDetected={applyScannedValue}
              t={t}
            />
          ) : null}
        </Suspense>
      ) : null}
      {createVerdictOpen ? (
        <Modal
          title={createVerdict.kind === 'exact_twin'
            ? tr('create_match_twin_title', 'Product already exists', 'ផលិតផលមានរួចហើយ')
            : createVerdict.kind === 'name_match'
              ? tr('create_match_name_title', 'Name already exists', 'ឈ្មោះមានរួចហើយ')
              : tr('create_match_barcode_title', 'Barcode already in use', 'បាកូដកំពុងប្រើរួចហើយ')}
          onClose={() => resolveCreateVerdict('back')}
          size="sm"
        >
          <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
            <div className={`flex items-start gap-3 rounded-lg border p-3 ${createVerdict.kind === 'exact_twin'
              ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/30'
              : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30'}`}>
              <AlertTriangleIcon className={`mt-0.5 h-4 w-4 shrink-0 ${createVerdict.kind === 'exact_twin' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`} />
              <div className={`space-y-1 ${createVerdict.kind === 'exact_twin' ? 'text-red-800 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
                <p>
                  {createVerdict.kind === 'exact_twin'
                    ? tr('create_match_twin_body', 'An identical product already exists — same name and same barcode. Go back and adjust, or open the existing product instead.', 'ផលិតផលដូចគ្នាបេះបិទមានរួចហើយ — ឈ្មោះ និងបាកូដដូចគ្នា។ ត្រឡប់ក្រោយ ហើយកែសម្រួល ឬបើកផលិតផលដែលមានស្រាប់ជំនួសវិញ។')
                    : createVerdict.kind === 'name_match'
                      ? tr('create_match_name_body', 'A product with this exact name already exists. Saving will add this as a child row of that group.', 'ផលិតផលដែលមានឈ្មោះដូចគ្នាបេះបិទមានរួចហើយ។ ការរក្សាទុកនឹងបន្ថែមវាជាជួរកូននៃក្រុមនោះ។')
                      : tr('create_match_barcode_body', 'This barcode already belongs to "{name}". Join that group (adopting its name), or keep this as a separate product that shares the barcode.', 'បាកូដនេះជារបស់ "{name}" រួចហើយ។ ចូលរួមក្រុមនោះ (ដោយយកឈ្មោះរបស់វា) ឬរក្សាវាជាផលិតផលដាច់ដោយឡែកដែលប្រើបាកូដរួមគ្នា។').replace('{name}', createVerdict.canonicalName)}
                </p>
                {createVerdict.priceMatches ? (
                  <p className="text-xs">
                    {tr('create_match_price_advisory', 'The selling price also matches an existing row — worth a second look before creating.', 'តម្លៃលក់ក៏ត្រូវគ្នានឹងជួរដែលមានស្រាប់ដែរ — គួរពិនិត្យម្តងទៀតមុនបង្កើត។')}
                  </p>
                ) : null}
              </div>
            </div>
            {createVerdict.beforeAfter.child || (createVerdict.allowProceedAsNew && createVerdict.beforeAfter.asNew) ? (
              <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                {createVerdict.beforeAfter.child ? (
                  <p><span className="font-semibold">{tr('create_match_child_label', 'As a child:', 'ជាកូន៖')}</span> {createVerdict.beforeAfter.child}</p>
                ) : null}
                {createVerdict.allowProceedAsNew && createVerdict.beforeAfter.asNew ? (
                  <p><span className="font-semibold">{tr('create_match_new_label', 'As new:', 'ជាថ្មី៖')}</span> {createVerdict.beforeAfter.asNew}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300"
                onClick={() => resolveCreateVerdict('back')}
              >
                {tr('create_match_back', 'Go back', 'ត្រឡប់ក្រោយ')}
              </button>
              {createVerdict.kind !== 'exact_twin' ? (
                <button
                  type="button"
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700"
                  onClick={() => resolveCreateVerdict('child')}
                >
                  {tr('create_match_child_button', 'Add as child of "{name}"', 'បន្ថែមជាកូននៃ "{name}"').replace('{name}', createVerdict.canonicalName)}
                </button>
              ) : null}
              {createVerdict.allowProceedAsNew ? (
                <button
                  type="button"
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300"
                  onClick={() => resolveCreateVerdict('new')}
                >
                  {tr('create_match_new_button', 'Create as a separate product', 'បង្កើតជាផលិតផលដាច់ដោយឡែក')}
                </button>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
      {nameUnlockConfirmOpen ? (
        <Modal title={tr('unlock_name_confirm_title', 'Unlock product name?', 'ដោះសោឈ្មោះផលិតផល?')} onClose={() => setNameUnlockConfirmOpen(false)} size="sm">
          <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300">
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-950/30">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-amber-800 dark:text-amber-300">
                {tr(
                  'unlock_name_confirm_body',
                  'This product\'s name is locked because it\'s grouped with other products by name. Unlocking and saving a different name will remove it from that group. Continue?',
                  'ឈ្មោះផលិតផលនេះជាប់សោ ព្រោះវាស្ថិតនៅក្នុងក្រុមជាមួយផលិតផលផ្សេងទៀតតាមឈ្មោះ។ ការដោះសោ ហើយរក្សាទុកឈ្មោះផ្សេង នឹងដកវាចេញពីក្រុមនោះ។ បន្ត?',
                )}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700"
                onClick={() => {
                  setNameUnlocked(true)
                  setNameUnlockConfirmOpen(false)
                  // Focus the now-editable field right away so unlocking
                  // reads as one continuous action, not two separate clicks.
                  setTimeout(() => nameInputRef.current?.focus(), 0)
                }}
              >
                {tr('unlock_name_confirm_button', 'Unlock', 'ដោះសោ')}
              </button>
              <button
                type="button"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300"
                onClick={() => setNameUnlockConfirmOpen(false)}
              >
                {tr('cancel', 'Cancel', 'បោះបង់')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </Modal>
  )
}
