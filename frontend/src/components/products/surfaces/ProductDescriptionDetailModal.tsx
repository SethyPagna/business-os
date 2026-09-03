// Admin-side counterpart to the public-portal Details flyout
// (catalog/ProductDetailFlyout.tsx). Aug 23 ask: the Products detail
// sheet's description Row stays compact through horizontal scrolling, and
// clicking it opens a
// separate view with the same formatted Features/Benefits/Ingredients/
// Caution breakdown the public portal already shows shoppers -- so
// staff editing a product see it exactly the way a customer will,
// rather than a second, differently-formatted admin-only view.
//
// Deliberately its own small component, not a re-render of
// ProductDetailFlyout itself: that component is portal-shaped (image
// gallery, live stock-status pill, price presentation, add-to-bucket
// button, "sold by" shop note) and none of that belongs in an admin
// staff-facing read-only preview. Both share the same parsing utility
// (parseProductDescription) and the same section icon/label set so the
// two surfaces stay visually consistent without duplicating the parser.
import X from 'lucide-react/dist/esm/icons/x.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import Leaf from 'lucide-react/dist/esm/icons/leaf.js'
import TriangleAlert from 'lucide-react/dist/esm/icons/alert-triangle.js'
import Users2 from 'lucide-react/dist/esm/icons/users.js'
import type { LucideIcon } from 'lucide-react'
import { parseProductDescription } from '../../catalog/productDetailSections.ts'
import type { ProductDetailSectionKey } from '../../catalog/productDetailSections.ts'

type Translate = (key: string) => string | undefined

type ProductDescriptionDetailModalProps = {
  productName: string
  description?: string
  category?: string
  brand?: string
  onClose: () => void
  t?: Translate
}

// Kept in sync with catalog/ProductDetailFlyout.tsx's own SECTION_META --
// same label set (extended for the "Features & Benefits"/"Who is it for?"
// Customer Portal import-column wiring), same icons, so staff see the
// identical breakdown a shopper would.
const SECTION_META: Record<ProductDetailSectionKey, { icon: LucideIcon; labelKey: string; fallback: string }> = {
  features: { icon: Sparkles, labelKey: 'productFeatures', fallback: 'Features' },
  benefits: { icon: BadgePercent, labelKey: 'productBenefits', fallback: 'Benefits' },
  features_benefits: { icon: Sparkles, labelKey: 'productFeaturesBenefits', fallback: 'Features & Benefits' },
  who_for: { icon: Users2, labelKey: 'productWhoFor', fallback: 'Who is it for?' },
  ingredients: { icon: Leaf, labelKey: 'productIngredients', fallback: 'Ingredients' },
  caution: { icon: TriangleAlert, labelKey: 'productCaution', fallback: 'Caution' },
}

export default function ProductDescriptionDetailModal({
  productName,
  description,
  category,
  brand,
  onClose,
  t,
}: ProductDescriptionDetailModalProps) {
  const T = (key: string, fallback: string) => {
    const translated = typeof t === 'function' ? t(key) : ''
    return translated && translated !== key ? translated : fallback
  }
  const parsed = parseProductDescription(description)

  return (
    // P2-4 Part 1b: was a literal `z-[60]` and a hand-rolled `bg-black/50`.
    // This renders inside ProductDetailModal's own portal tree, so it is a
    // modal opened from within a modal -- --z-modal-2 says exactly that,
    // where 60 said nothing and only happened to work because the enclosing
    // --z-modal element creates its own stacking context. The overlay tint
    // now comes from the one shared --ui-backdrop token like every other
    // modal layer, so light/dark stay consistent with the rest of the app.
    <div className="fixed inset-0 z-[var(--z-modal-2)] flex items-end justify-center bg-[var(--ui-backdrop)] p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[85dvh] sm:max-w-2xl sm:rounded-2xl dark:bg-gray-800"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Top close button, per the site-wide "top+bottom close" pattern
            the public flyout already uses. */}
        <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
          <div className="min-w-0 pr-4">
            <p className="break-words text-base font-semibold text-gray-900 dark:text-white">{productName}</p>
            {(category || brand) ? (
              <p className="detail-scroll-text mt-0.5 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {[category, brand].filter(Boolean).join(' \u00b7 ')}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={T('close', 'Close')}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {parsed.intro ? (
            <p className="whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300">{parsed.intro}</p>
          ) : null}

          {parsed.sections.map((section) => {
            const meta = SECTION_META[section.key]
            const SectionIcon = meta.icon
            return (
              <div key={section.key}>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <SectionIcon className="h-3.5 w-3.5" />
                  {T(meta.labelKey, meta.fallback)}
                </div>
                {section.items.length > 1 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    {section.items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-300">{section.items[0]}</p>
                )}
              </div>
            )
          })}

          {!parsed.intro && !parsed.sections.length ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">{T('no_description', 'No description available.')}</p>
          ) : null}
        </div>

        {/* Bottom close button, matching the top one -- same "top+bottom
            close" convention as the public flyout. */}
        <div className="border-t border-gray-200 p-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {T('close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  )
}
