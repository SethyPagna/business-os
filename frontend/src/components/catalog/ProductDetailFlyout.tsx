import { Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import X from 'lucide-react/dist/esm/icons/x.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import Store from 'lucide-react/dist/esm/icons/store.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import Leaf from 'lucide-react/dist/esm/icons/leaf.js'
import TriangleAlert from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Users2 from 'lucide-react/dist/esm/icons/users.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import type { LucideIcon } from 'lucide-react'
import CatalogProductImage from './catalogImages'
import { StatusPill } from './catalogUi'
import { parseProductDescription } from './productDetailSections.ts'
import type { ProductDetailSectionKey } from './productDetailSections.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'

// Same lightbox CatalogPreviewSurface already uses -- lazily loaded so the
// storefront's first paint does not carry it.
const ImageGalleryLightbox = lazyRetry(() => import('../shared/ImageGalleryLightbox'), 'portal-detail-image-gallery-lightbox')

type CopyFn = (key: string, fallback?: string) => string
type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | string

export type ProductDetailViewProduct = {
  id: number | string
  name?: string
  description?: string
  category?: string
  brand?: string
  // Multi-value forms written by migration 0033 -- "Skincare||Gift Set".
  // The singular columns above stay populated with the FIRST value, so a
  // caller that only has those still renders correctly.
  categories?: string
  brands?: string
  discount_label?: string
}

/** Splits a `||`-joined multi-value cell, falling back to the single value. */
function multiValues(multi: unknown, single: unknown): string[] {
  const joined = String(multi ?? '').trim()
  const source = joined || String(single ?? '').trim()
  if (!source) return []
  return source.split('||').map((part) => part.trim()).filter(Boolean)
}

export type ProductDetailViewState = {
  open: boolean
  product: ProductDetailViewProduct | null
  gallery: string[]
  status: StockStatus
  pricePresentation: { primaryText?: string; originalText?: string; promotion?: { active?: boolean } } | null
  showPrices?: boolean
}

type ProductDetailFlyoutProps = {
  view: ProductDetailViewState
  copy: CopyFn
  onClose: () => void
  // "Sold by {shopName}" note in the footer -- see productDetailSections.ts's
  // own comment on why this reuses the existing free-text `description`
  // field instead of new columns; shopName/contactNote are the "shop-name"
  // and "notes" halves of the Aug 22 ask, sourced from the portal's own
  // display settings (business name + its existing header contact links)
  // rather than inventing a new per-product field neither the schema nor
  // the import template actually has.
  shopName?: string
  contactNote?: string
  // Aug 24 request (Part 326 backlog item 3): a single Caution / Need More
  // Details pair, set once in the Customer Portal editor and applied to
  // EVERY product -- not parsed per-product. Only shown as a fallback:
  // if a product's own description already has a "Caution:" section
  // (parseProductDescription found one), that per-product text wins and
  // this default is not also shown, to avoid a product-specific caution
  // being followed immediately by a generic one that might read as
  // contradictory. "Need More Details" has no per-product equivalent to
  // defer to -- it always renders when a non-empty default is supplied.
  cautionDefault?: string
  needMoreDetailsDefault?: string
  onAddToBucket?: (product: ProductDetailViewProduct, priceText?: string) => void
  bucketQty?: number
}

const SECTION_META: Record<ProductDetailSectionKey, { icon: LucideIcon; labelKey: string; fallback: string }> = {
  features: { icon: Sparkles, labelKey: 'productFeatures', fallback: 'Features' },
  benefits: { icon: BadgePercent, labelKey: 'productBenefits', fallback: 'Benefits' },
  // Aug 24 request's label set (Part 326 backlog item 3): "Features &
  // Benefits" and "Who is it for?" are new labels productDetailSections.ts
  // now recognizes alongside the original four -- an existing product
  // still using the old separate "Features:"/"Benefits:" labels keeps
  // rendering through the two entries above, unchanged.
  features_benefits: { icon: Sparkles, labelKey: 'productFeaturesBenefits', fallback: 'Features & Benefits' },
  who_for: { icon: Users2, labelKey: 'productWhoFor', fallback: 'Who is it for?' },
  ingredients: { icon: Leaf, labelKey: 'productIngredients', fallback: 'Ingredients' },
  caution: { icon: TriangleAlert, labelKey: 'productCaution', fallback: 'Caution' },
}


function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">{label}</div>
      {children}
    </div>
  )
}

export default function ProductDetailFlyout({ view, copy, onClose, shopName, contactNote, cautionDefault, needMoreDetailsDefault, onAddToBucket, bucketQty = 0 }: ProductDetailFlyoutProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const product = view.product
  if (!product) return null

  const gallery = view.gallery.length ? view.gallery : []
  const activeImage = gallery[Math.min(activeIndex, Math.max(gallery.length - 1, 0))] || ''
  const parsed = parseProductDescription(product.description)
  const categoryValues = multiValues(product.categories, product.category)
  const brandValues = multiValues(product.brands, product.brand)
  const promotion = view.pricePresentation?.promotion

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[88vh] sm:max-w-3xl sm:rounded-2xl dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-neutral-800">
          <div className="min-w-0 pr-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
              {copy('productShopName', "Shop's Product Name")}
            </div>
            <div {...getKhmerTextProps(product.name || '', 'truncate text-base font-semibold text-slate-900 dark:text-white')}>
              {product.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy('close', 'Close')}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {/* One image at a time, as a card. Arrows step through the set and
              the image itself opens the lightbox, where the photos can be
              viewed on their own without the rest of the page. The thumbnail
              strip below stays as a direct way to jump to a specific photo. */}
          <div className="relative aspect-[4/3] max-h-[22rem] w-full bg-slate-100 dark:bg-neutral-800 sm:max-h-[26rem]">
            {activeImage ? (
              <button
                type="button"
                className="block h-full w-full cursor-zoom-in"
                onClick={() => setLightboxOpen(true)}
                aria-label={copy('viewImages', 'View images')}
              >
                <CatalogProductImage src={activeImage} alt={product.name || ''} className="h-full w-full object-contain" />
              </button>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-300">
                <ShoppingBag className="h-14 w-14" />
              </div>
            )}
            {gallery.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => setActiveIndex((current) => (current - 1 + gallery.length) % gallery.length)}
                  aria-label={copy('prevImage', 'Previous image')}
                  className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-md backdrop-blur transition hover:bg-white dark:bg-neutral-900/85 dark:text-neutral-100 dark:hover:bg-neutral-900"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveIndex((current) => (current + 1) % gallery.length)}
                  aria-label={copy('nextImage', 'Next image')}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-slate-700 shadow-md backdrop-blur transition hover:bg-white dark:bg-neutral-900/85 dark:text-neutral-100 dark:hover:bg-neutral-900"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
                  {activeIndex + 1}/{gallery.length}
                </div>
              </>
            ) : null}
          </div>
          {gallery.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto p-3">
              {gallery.map((image, index) => (
                <button
                  type="button"
                  key={`${image}-${index}`}
                  onClick={() => setActiveIndex(index)}
                  className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border-2 ${index === activeIndex ? 'border-slate-900 dark:border-white' : 'border-transparent'}`}
                >
                  <CatalogProductImage src={image} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-4 p-4 pt-2">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={view.status} copy={copy} />
              {promotion?.active ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                  <BadgePercent className="h-3 w-3" />
                  {product.discount_label || copy('discounts', 'Discount')}
                </span>
              ) : null}
            </div>

            {view.showPrices && view.pricePresentation?.primaryText ? (
              <div className="text-xl font-semibold text-slate-900 dark:text-white">
                {view.pricePresentation.primaryText}
                {view.pricePresentation.originalText ? (
                  <span className="ml-2 text-sm font-normal text-slate-400 line-through dark:text-neutral-500">
                    {view.pricePresentation.originalText}
                  </span>
                ) : null}
              </div>
            ) : null}

            {parsed.officialName ? (
              <DetailField label={copy('productOfficialName', 'Official Product Name')}>
                <p {...getKhmerTextProps(parsed.officialName, 'whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-neutral-300')}>
                  {parsed.officialName}
                </p>
              </DetailField>
            ) : null}

            {parsed.intro ? (
              <DetailField label={copy('productIntroduction', 'Introduction')}>
                <p {...getKhmerTextProps(parsed.intro, 'whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-neutral-300')}>
                  {parsed.intro}
                </p>
              </DetailField>
            ) : null}

            {parsed.sections.filter((section) => section.key === 'features_benefits' || section.key === 'features' || section.key === 'benefits').map((section) => {
              const meta = SECTION_META[section.key]
              const SectionIcon = meta.icon
              return (
                <div key={section.key}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    <SectionIcon className="h-3.5 w-3.5" />
                    {copy(meta.labelKey, meta.fallback)}
                  </div>
                  {section.items.length > 1 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600 dark:text-neutral-300">
                      {section.items.map((item, index) => (
                        <li key={index} {...getKhmerTextProps(item, '')}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p {...getKhmerTextProps(section.items[0] || '', 'whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-neutral-300')}>
                      {section.items[0]}
                    </p>
                  )}
                </div>
              )
            })}

            {categoryValues.length ? (
              <DetailField label={copy('productCategory', 'Category')}>
                <p className="text-sm leading-6 text-slate-600 dark:text-neutral-300">{categoryValues.join(', ')}</p>
              </DetailField>
            ) : null}

            {brandValues.length ? (
              <DetailField label={copy('productBrand', 'Brand')}>
                <p className="text-sm leading-6 text-slate-600 dark:text-neutral-300">{brandValues.join(', ')}</p>
              </DetailField>
            ) : null}

            {parsed.sections.filter((section) => section.key === 'who_for' || section.key === 'ingredients' || section.key === 'caution').map((section) => {
              const meta = SECTION_META[section.key]
              const SectionIcon = meta.icon
              return (
                <div key={section.key}>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    <SectionIcon className="h-3.5 w-3.5" />
                    {copy(meta.labelKey, meta.fallback)}
                  </div>
                  {section.items.length > 1 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600 dark:text-neutral-300">
                      {section.items.map((item, index) => (
                        <li key={index} {...getKhmerTextProps(item, '')}>{item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p {...getKhmerTextProps(section.items[0] || '', 'whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-neutral-300')}>
                      {section.items[0]}
                    </p>
                  )}
                </div>
              )
            })}

            {cautionDefault && !parsed.sections.some((section) => section.key === 'caution') ? (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  {copy('productCaution', 'Caution')}
                </div>
                <p {...getKhmerTextProps(cautionDefault, 'whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-neutral-300')}>
                  {cautionDefault}
                </p>
              </div>
            ) : null}

            {needMoreDetailsDefault ? (
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                  <Store className="h-3.5 w-3.5" />
                  {copy('productNeedMoreDetails', 'Need More Details')}
                </div>
                <p {...getKhmerTextProps(needMoreDetailsDefault, 'whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-neutral-300')}>
                  {needMoreDetailsDefault}
                </p>
              </div>
            ) : null}

            {!parsed.intro && !parsed.sections.length ? (
              <p className="text-sm text-slate-400 dark:text-neutral-500">{copy('noDescription', 'No description available.')}</p>
            ) : null}

            {shopName ? (
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-neutral-800/60 dark:text-neutral-400">
                <Store className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                <div>
                  <div className="font-medium text-slate-700 dark:text-neutral-200">{shopName}</div>
                  {contactNote ? <div className="mt-0.5">{contactNote}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 p-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {copy('close', 'Close')}
          </button>
          {onAddToBucket ? (
            <button
              type="button"
              onClick={() => onAddToBucket(product, view.pricePresentation?.primaryText)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            >
              <Plus className="h-4 w-4" />
              {copy('addToBucket', 'Add')}
              {bucketQty > 0 ? (
                <span className="ml-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-bold leading-4">
                  {bucketQty}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
      </div>

      {/* Images on their own, away from the rest of the page. Rendered
          outside the card so the card's own click-to-close cannot fire while
          the lightbox is up. */}
      <Suspense fallback={null}>
        {lightboxOpen && gallery.length ? (
          <ImageGalleryLightbox
            open
            title={product.name || ''}
            images={gallery}
            index={activeIndex}
            onClose={() => setLightboxOpen(false)}
            onIndexChange={(index: number) => setActiveIndex(index)}
            labels={{
              prev: copy('prevImage', 'Previous image'),
              next: copy('nextImage', 'Next image'),
              imageCount: copy('imageCount', '{current}/{total}'),
              dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
            }}
          />
        ) : null}
      </Suspense>
    </div>
  )
}
