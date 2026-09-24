import { useEffect, useMemo, useRef, useState } from 'react'
import { isSafeLinkUrl } from '../../utils/safeLinkUrl.ts'
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical.js'
import ImageIcon from 'lucide-react/dist/esm/icons/image.js'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Modal from '../shared/Modal'
import AppSelect from '../shared/AppSelect.tsx'
import DateEntryInput from '../shared/DateEntryInput.tsx'
import ConfirmDialog, { type ConfirmReviewItem } from '../shared/ConfirmDialog.tsx'
import { fmtDateOnly } from '../../utils/formatters.ts'
import { useApp } from '../../AppContext.tsx'
import type { AppContextCoreValue } from '../../app/AppContextCore.tsx'
import {
  getPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  reorderPromotions,
  type Promotion,
} from '../../api/promotionsTransport.ts'
import { uploadFileAsset } from '../../api/fileTransport.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'

type EditableFields = {
  title: string
  subtitle: string
  image_path: string
  link_type: 'none' | 'product' | 'url'
  link_product_id: string
  link_url: string
  badge_text: string
  badge_color: string
  is_active: boolean
  starts_at: string
  ends_at: string
}

const BLANK_FORM: EditableFields = {
  title: '',
  subtitle: '',
  image_path: '',
  link_type: 'none',
  link_product_id: '',
  link_url: '',
  badge_text: '',
  badge_color: '#dc2626',
  is_active: true,
  starts_at: '',
  ends_at: '',
}

const BADGE_COLOR_PRESETS = [
  { key: 'color_red', label: 'Red', value: '#dc2626' },
  { key: 'color_orange', label: 'Orange', value: '#ea580c' },
  { key: 'color_amber', label: 'Amber', value: '#d97706' },
  { key: 'color_green', label: 'Green', value: '#16a34a' },
  { key: 'color_blue', label: 'Blue', value: '#2563eb' },
  { key: 'color_purple', label: 'Purple', value: '#7c3aed' },
  { key: 'color_pink', label: 'Pink', value: '#db2777' },
]

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

// The card at `from` takes the slot at `to`; the cards between shift over.
function moveCard(list: Promotion[], from: number, to: number): Promotion[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

function toFormFields(promo: Promotion): EditableFields {
  return {
    title: promo.title || '',
    subtitle: promo.subtitle || '',
    image_path: promo.image_path || '',
    link_type: promo.link_type || 'none',
    link_product_id: promo.link_product_id != null ? String(promo.link_product_id) : '',
    link_url: promo.link_url || '',
    badge_text: promo.badge_text || '',
    badge_color: promo.badge_color || '#dc2626',
    is_active: promo.is_active !== 0,
    starts_at: promo.starts_at ? promo.starts_at.slice(0, 10) : '',
    ends_at: promo.ends_at ? promo.ends_at.slice(0, 10) : '',
  }
}

function toSavePayload(fields: EditableFields): Partial<Promotion> {
  return {
    title: fields.title.trim(),
    subtitle: fields.subtitle.trim() || null,
    image_path: fields.image_path || null,
    link_type: fields.link_type,
    link_product_id: fields.link_type === 'product' && fields.link_product_id ? Number(fields.link_product_id) : null,
    link_url: fields.link_type === 'url' ? fields.link_url.trim() || null : null,
    badge_text: fields.badge_text.trim() || null,
    badge_color: fields.badge_color || null,
    is_active: fields.is_active ? 1 : 0,
    starts_at: fields.starts_at ? new Date(fields.starts_at).toISOString() : null,
    ends_at: fields.ends_at ? new Date(`${fields.ends_at}T23:59:59`).toISOString() : null,
  }
}

type ProductOption = { id: number; name: string }

export type ManagePromotionsModalProps = {
  onClose: () => void
  productOptions?: ProductOption[]
}

export default function ManagePromotionsModal({ onClose, productOptions = [] }: ManagePromotionsModalProps) {
  const { notify, t, user } = useApp() as AppContextCoreValue
  // The packs are flattened by leaf key, so pages.portalEditor.newPromotion
  // is read as t('newPromotion'); a dotted 'portalEditor.' lookup never hits.
  const copy = (key: string, fallback: string) => {
    const translated = typeof t === 'function' ? t(key) : ''
    return translated && translated !== key ? translated : fallback
  }
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState<EditableFields>(BLANK_FORM)
  const [saving, setSaving] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [orderSaving, setOrderSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Promotion | null>(null)
  const [deleting, setDeleting] = useState(false)
  const draggingIdRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const loadPromotions = async () => {
    setLoading(true)
    try {
      const rows = await getPromotions()
      if (aliveRef.current) setPromotions(Array.isArray(rows) ? rows : [])
    } catch (error) {
      notify(getErrorMessage(error, copy('loadPromotionsFailed', 'Failed to load promotions')), 'error')
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadPromotions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const productNameById = useMemo(() => {
    const map = new Map<number, string>()
    productOptions.forEach((p) => map.set(p.id, p.name))
    return map
  }, [productOptions])

  const startCreate = () => {
    setForm(BLANK_FORM)
    setEditingId('new')
  }

  const startEdit = (promo: Promotion) => {
    setForm(toFormFields(promo))
    setEditingId(promo.id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(BLANK_FORM)
  }

  const handleImageChosen = async (file: File) => {
    setUploadBusy(true)
    setUploadProgress(0)
    try {
      const uploaded = await uploadFileAsset({
        file,
        userId: (user?.id as string | number | null | undefined) ?? null,
        userName: user?.name != null ? String(user.name) : null,
        onProgress: ({ percent }: { percent: number }) => setUploadProgress(percent),
      }) as { public_path?: string; error?: string }
      if (!uploaded?.public_path) throw new Error(uploaded?.error || copy('image_upload_failed', 'Image upload failed'))
      setForm((prev) => ({ ...prev, image_path: uploaded.public_path as string }))
    } catch (error) {
      notify(getErrorMessage(error, copy('image_upload_failed', 'Image upload failed')), 'error')
    } finally {
      if (aliveRef.current) {
        setUploadBusy(false)
        setUploadProgress(0)
      }
    }
  }

  const validate = (): string | null => {
    if (!form.title.trim()) return copy('titleRequired', 'Title is required')
    if (form.link_type === 'product' && !form.link_product_id) return copy('chooseProductToLink', 'Choose a product to link to')
    if (form.link_type === 'url' && !form.link_url.trim()) return copy('enterLinkUrl', 'Enter a link URL')
    // Same allowlist the Worker enforces (cloudflare/src/lib/safeLinkUrl.ts):
    // http(s) or a site-relative path. Checked here so the author is told
    // what is wrong with their link instead of getting a bare 400 back.
    if (form.link_type === 'url' && !isSafeLinkUrl(form.link_url)) return copy('strip_link_url_invalid', 'Use a link that starts with https:// or a page path that starts with /.')
    if (form.starts_at && form.ends_at && form.starts_at > form.ends_at) return copy('endDateAfterStart', 'End date must be after start date')
    return null
  }

  const handleSave = async () => {
    const validationError = validate()
    if (validationError) {
      notify(validationError, 'error')
      return
    }
    setSaving(true)
    try {
      const payload = toSavePayload(form)
      if (editingId === 'new') {
        await createPromotion(payload)
        notify(copy('promotionCreated', 'Promotion created'), 'success')
      } else if (editingId != null) {
        await updatePromotion(editingId, payload)
        notify(copy('promotionUpdated', 'Promotion updated'), 'success')
      }
      cancelEdit()
      await loadPromotions()
    } catch (error) {
      notify(getErrorMessage(error, copy('savePromotionFailed', 'Failed to save promotion')), 'error')
    } finally {
      if (aliveRef.current) setSaving(false)
    }
  }

  // What a card opens when tapped: the product, the link, or nothing ('').
  const linkTarget = (promo: Promotion) => (
    promo.link_type === 'product'
      ? productNameById.get(promo.link_product_id || 0) || copy('genericProductLabel', 'a product')
      : promo.link_type === 'url' ? String(promo.link_url || '') : ''
  )

  // The delete confirmation shows the card being removed, not a bare yes/no
  // (and replaces a native window.confirm, whose buttons cannot be translated).
  const deleteReviewItems = (promo: Promotion): ConfirmReviewItem[] => [
    { label: copy('title', 'Title'), value: promo.title },
    ...(promo.subtitle ? [{ label: copy('subtitle', 'Subtitle'), value: promo.subtitle }] : []),
    ...(promo.badge_text ? [{ label: copy('badgeText', 'Badge text'), value: promo.badge_text }] : []),
    { label: copy('linksTo', 'Links to'), value: linkTarget(promo) || copy('noLink', 'No link') },
    { label: copy('status', 'Status'), value: promo.is_active ? copy('active', 'Active') : copy('hiddenBadge', 'Hidden') },
    ...(promo.starts_at ? [{ label: copy('showFromAria', 'Show from'), value: fmtDateOnly(promo.starts_at) }] : []),
    ...(promo.ends_at ? [{ label: copy('showUntilAria', 'Show until'), value: fmtDateOnly(promo.ends_at) }] : []),
  ]

  const handleDelete = async () => {
    const promo = pendingDelete
    if (!promo || deleting) return
    setDeleting(true)
    try {
      await deletePromotion(promo.id)
      notify(copy('promotionDeleted', 'Promotion deleted'), 'success')
      if (aliveRef.current) setPendingDelete(null)
      await loadPromotions()
    } catch (error) {
      notify(getErrorMessage(error, copy('deletePromotionFailed', 'Failed to delete promotion')), 'error')
    } finally {
      if (aliveRef.current) setDeleting(false)
    }
  }

  const handleToggleActive = async (promo: Promotion) => {
    try {
      await updatePromotion(promo.id, { ...promo, is_active: promo.is_active ? 0 : 1 })
      await loadPromotions()
    } catch (error) {
      notify(getErrorMessage(error, copy('updatePromotionFailed', 'Failed to update promotion')), 'error')
    }
  }

  // A move shows at once, then the list becomes the order the server
  // confirmed: the reorder PUT answers with every card in its stored order,
  // so a card another device added or moved meanwhile lands where it really
  // is (same reconcile as the Notes list). Moves are one at a time -- the
  // next waits for this answer -- so an older answer never lands on top of a
  // newer move. A failed save reloads the stored order instead of leaving an
  // order on screen that never saved.
  const saveOrder = async (next: Promotion[]) => {
    if (orderSaving) return
    setPromotions(next)
    setOrderSaving(true)
    try {
      const rows = await reorderPromotions(next.map((p) => p.id))
      if (!aliveRef.current) return
      if (Array.isArray(rows)) setPromotions(rows)
      else await loadPromotions()
    } catch (error) {
      notify(getErrorMessage(error, copy('saveOrderFailed', 'Failed to save new order')), 'error')
      await loadPromotions()
    } finally {
      if (aliveRef.current) setOrderSaving(false)
    }
  }

  const handleDrop = (targetId: number) => {
    const draggingId = draggingIdRef.current
    setDragOverId(null)
    draggingIdRef.current = null
    if (draggingId == null || draggingId === targetId) return
    const fromIndex = promotions.findIndex((p) => p.id === draggingId)
    const toIndex = promotions.findIndex((p) => p.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return
    void saveOrder(moveCard(promotions, fromIndex, toIndex))
  }

  const isEditing = editingId !== null

  return (
    <Modal title={copy('announcementStrip', 'Announcement strip')} onClose={onClose} size="lg" unsavedChanges={{ dirty: editingId !== null }}>
      <div className="flex flex-col gap-4 overflow-y-auto p-5">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {copy('announcementStripIntro', 'Small, quick banner cards that scroll horizontally at the very top of the website — for short sale/announcement callouts. This is separate from the larger "Promotions and posts" cards further down the Website Editor, which suit longer campaign posts with full descriptions. Drag cards below to reorder them; the order here is the order customers see.')}
        </p>

        {!isEditing && (
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 hover:shadow"
          >
            <Plus className="h-4 w-4" />
            {copy('newPromotion', 'New promotion')}
          </button>
        )}

        {isEditing && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {editingId === 'new' ? copy('newPromotion', 'New promotion') : copy('editPromotion', 'Edit promotion')}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('title', 'Title')} *</span>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder={copy('promotionTitlePlaceholder', 'Summer Sale')}
                  maxLength={120}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('subtitle', 'Subtitle')}</span>
                <input
                  type="text"
                  value={form.subtitle}
                  onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))}
                  placeholder={copy('promotionSubtitlePlaceholder', '20% off all skincare this week')}
                  maxLength={240}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <div className="flex flex-col gap-1 text-sm sm:col-span-2">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('image', 'Image')}</span>
                <div className="flex items-center gap-3">
                  {form.image_path ? (
                    <img
                      src={resolvePublicAssetUrl(form.image_path)}
                      alt=""
                      className="h-16 w-24 rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                    />
                  ) : (
                    <div className="flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
                      <ImageIcon className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                      <span className="text-[10px] text-gray-400">{copy('noImage', 'No image')}</span>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleImageChosen(file)
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadBusy}
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {uploadBusy ? `${copy('uploading', 'Uploading...')} ${uploadProgress}%` : form.image_path ? copy('replaceImage', 'Replace image') : copy('uploadImage', 'Upload image')}
                  </button>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('badgeText', 'Badge text')}</span>
                <input
                  type="text"
                  value={form.badge_text}
                  onChange={(e) => setForm((p) => ({ ...p, badge_text: e.target.value }))}
                  placeholder={copy('badgeTextPlaceholder', 'SALE')}
                  maxLength={40}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('badgeColor', 'Badge color')}</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {BADGE_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      title={copy(preset.key, preset.label)}
                      aria-label={copy(preset.key, preset.label)}
                      aria-pressed={form.badge_color === preset.value}
                      onClick={() => setForm((p) => ({ ...p, badge_color: preset.value }))}
                      className={`h-6 w-6 rounded-full border-2 ${form.badge_color === preset.value ? 'border-gray-900 dark:border-white' : 'border-transparent'}`}
                      style={{ backgroundColor: preset.value }}
                    />
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('linksTo', 'Links to')}</span>
                <AppSelect
                  value={form.link_type}
                  buttonClassName="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900"
                  options={[
                    { value: 'none', label: copy('strip_link_none', 'Nothing (just a banner)') },
                    { value: 'product', label: copy('promotionLinkProduct', 'A product') },
                    { value: 'url', label: copy('strip_link_url', 'A link / page') },
                  ]}
                  onChange={(value) => setForm((p) => ({ ...p, link_type: value as EditableFields['link_type'] }))}
                />
              </label>

              {form.link_type === 'product' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{copy('product', 'Product')} *</span>
                  <AppSelect
                    value={form.link_product_id}
                    buttonClassName="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal dark:border-gray-700 dark:bg-gray-900"
                    options={[
                      { value: '', label: copy('selectProduct', 'Select a product…') },
                      ...productOptions.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onChange={(value) => setForm((p) => ({ ...p, link_product_id: value }))}
                  />
                </label>
              )}

              {form.link_type === 'url' && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">{copy('strip_link_url_label', 'Link URL')} *</span>
                  <input
                    type="text"
                    value={form.link_url}
                    onChange={(e) => setForm((p) => ({ ...p, link_url: e.target.value }))}
                    placeholder={copy('linkUrlPlaceholder', '/catalog?category=Skincare or https://…')}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  />
                </label>
              )}

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('showFrom', 'Show from (optional)')}</span>
                {/* Typed, not a native picker (Sep 3) -- app-wide rule. */}
                <DateEntryInput
                  bare
                  t={t}
                  ariaLabel={copy('showFromAria', 'Show from')}
                  value={form.starts_at}
                  onChange={(iso) => setForm((p) => ({ ...p, starts_at: iso }))}
                  className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('showUntil', 'Show until (optional)')}</span>
                <DateEntryInput
                  bare
                  t={t}
                  ariaLabel={copy('showUntilAria', 'Show until')}
                  value={form.ends_at}
                  onChange={(iso) => setForm((p) => ({ ...p, ends_at: iso }))}
                  className="rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
                />
              </label>

              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((p) => ({ ...p, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded"
                />
                <span className="font-medium text-gray-700 dark:text-gray-300">{copy('visibleOnPortalNow', 'Visible on the website now')}</span>
              </label>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                {copy('cancel', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={saving || uploadBusy}
                onClick={handleSave}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? copy('saving_label', 'Saving…') : copy('savePromotion', 'Save promotion')}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((key) => (
              <div key={key} className="flex animate-pulse items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="h-4 w-4 rounded bg-gray-200 dark:bg-gray-800" />
                <div className="h-12 w-16 shrink-0 rounded-lg bg-gray-200 dark:bg-gray-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/3 rounded bg-gray-200 dark:bg-gray-800" />
                  <div className="h-2.5 w-1/2 rounded bg-gray-200 dark:bg-gray-800" />
                </div>
              </div>
            ))}
          </div>
        ) : promotions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 py-10 text-center dark:border-gray-700">
            <ImageIcon className="h-8 w-8 text-gray-300 dark:text-gray-600" />
            <div className="text-sm text-gray-500 dark:text-gray-400">{copy('noPromotionsYet', 'No promotions yet.')}</div>
            <div className="text-xs text-gray-400 dark:text-gray-500">{copy('clickNewPromotionHint', 'Click "New promotion" above to add your first banner.')}</div>
          </div>
        ) : (
          <div className={`flex flex-col gap-2 transition-opacity ${orderSaving ? 'opacity-70' : ''}`} aria-busy={orderSaving}>
            {orderSaving ? <span role="status" className="sr-only">{copy('saving', 'Saving...')}</span> : null}
            {promotions.map((promo) => (
              <div
                key={promo.id}
                draggable={!orderSaving}
                onDragStart={() => { draggingIdRef.current = promo.id }}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(promo.id) }}
                onDragLeave={() => setDragOverId((id) => (id === promo.id ? null : id))}
                onDrop={(e) => { e.preventDefault(); handleDrop(promo.id) }}
                className={`group flex items-center gap-3 rounded-xl border p-3 transition-all ${
                  dragOverId === promo.id
                    ? 'border-blue-400 bg-blue-50 shadow-sm dark:border-blue-700 dark:bg-blue-950/30'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:hover:border-gray-600'
                } ${promo.is_active ? '' : 'opacity-60'}`}
              >
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab select-none text-gray-300 transition group-hover:text-gray-400" aria-label={copy('dragToReorder', 'Drag to reorder')} />
                {promo.image_path ? (
                  <img src={resolvePublicAssetUrl(promo.image_path)} alt="" className="h-12 w-16 shrink-0 rounded-lg border border-gray-100 object-cover dark:border-gray-800" />
                ) : (
                  <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
                    <ImageIcon className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="detail-scroll-text text-sm font-semibold text-gray-900 dark:text-gray-100">{promo.title}</span>
                    {promo.badge_text ? (
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-white"
                        style={{ backgroundColor: promo.badge_color || '#dc2626' }}
                      >
                        {promo.badge_text}
                      </span>
                    ) : null}
                  </div>
                  <div className="detail-scroll-text text-xs text-gray-500 dark:text-gray-400">
                    {promo.subtitle || (linkTarget(promo)
                      ? `${copy('linksTo', 'Links to')}: ${linkTarget(promo)}`
                      : copy('noLink', 'No link'))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleActive(promo)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition ${
                    promo.is_active
                      ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/40 dark:text-green-300 dark:hover:bg-green-900/60'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                  }`}
                >
                  {promo.is_active ? copy('active', 'Active') : copy('hiddenBadge', 'Hidden')}
                </button>
                {/* Same icon+label-on-large/icon-only-on-small treatment as
                    the Products detail actions pane (ProductDetailModal.tsx)
                    -- label visually hidden below `sm:`, kept for screen
                    readers via the existing aria-label/title. */}
                <button
                  type="button"
                  onClick={() => startEdit(promo)}
                  title={copy('edit', 'Edit')}
                  aria-label={copy('editItemAria', 'Edit {name}').replace('{name}', promo.title)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{copy('edit', 'Edit')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(promo)}
                  title={copy('delete', 'Delete')}
                  aria-label={copy('deleteItemAria', 'Delete {name}').replace('{name}', promo.title)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{copy('delete', 'Delete')}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          t={t}
          layer="nested"
          danger
          title={copy('strip_delete_title', 'Delete promotion')}
          message={copy('deletePromotionConfirm', 'Delete "{name}"? This can\'t be undone.').replace('{name}', pendingDelete.title)}
          items={deleteReviewItems(pendingDelete)}
          confirmLabel={copy('delete', 'Delete')}
          cancelLabel={copy('cancel', 'Cancel')}
          working={deleting}
          workingLabel={copy('deleting', 'Deleting...')}
          onConfirm={handleDelete}
          onClose={() => { if (!deleting) setPendingDelete(null) }}
        />
      ) : null}
    </Modal>
  )
}
