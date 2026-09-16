import { useEffect, useMemo } from 'react'
import { COPY_ATTR, ensureTextAffordances, type AffordanceLabels } from './textAffordances.ts'

// Widest shape the surfaces in this lane actually pass: the two product
// detail modals hand over a two-argument `T(key, fallback)`, the Products
// list a three-argument `tr(key, fallback, khmerFallback)`.
type Translate = (key: string, fallback: string, khmerFallback?: string) => string | undefined

export type CopyFloatLabels = AffordanceLabels & { hint: string }

/** Attributes that turn any element into a copy-float trigger. */
export type CopyFloatProps = { 'data-copy-value'?: string; 'data-copy-success'?: string; title?: string; tabIndex?: number; role?: string; 'aria-label'?: string }

// Copy affordance for a product's NAME, BRAND, SUPPLIER and BARCODE:
// double-click on a pointer device, press-and-hold on touch, both opening
// the one shared float with the full value and a Copy button.
//
// Whether a PLAIN click or press also opens it depends on the surface, not
// on this hook: the controller gives both to whatever is underneath when
// something underneath wants them (see `claimsClick`). In the two product
// detail modals nothing does, so a click opens the panel and so does a
// press-and-hold. On the Products list the value sits inside a row that has
// no onClick at all outside selection mode -- it synthesises "open this
// product" from a tap and "enter select mode" from a hold, both off the
// press -- so the row keeps every press on a pointer device, and copying
// there is the double-click. Touch is the exception the ASK asks for: a
// hold on the value copies, because on a phone there is no other gesture
// left, and the row keeps the tap and every hold that is not on one of
// these four values.
//
// This hook hands back a props SPREAD rather than a wrapper component on
// purpose. The values it marks are a header <div>, a middot-separated
// <span> on a wrap line, a label/value row and a meta pill -- wrapping each
// in an extra element would change four different layouts to add a gesture,
// and one of them (the Products list supplier pill) is rendered by a
// callback this lane does not own. An attribute changes no layout at all.
//
// It is also deliberately a MARKER, not a controller: no panel, no
// open/closed state, no clipboard call lives here. All of that is the
// single delegated controller in textAffordances.ts -- the same one
// `TruncatedText` mounts for the tap-to-reveal, so "show me the rest of
// this text" has one implementation and one float, not two.
//
// Before this lane, nothing in the app could copy a product name, brand or
// supplier at all, and the only barcode copy was a bespoke plain-click
// button on one detail modal (products/surfaces/ProductDetailModal.tsx),
// which this lane replaces so there is one rule and one implementation.
export function useCopyFloat(t: Translate): (value: unknown) => CopyFloatProps {
  const labels = useMemo<CopyFloatLabels>(() => ({
    copy: String(t('copy', 'Copy') || 'Copy'),
    copied: String(t('copied', 'Copied') || 'Copied'),
    // `title` is a pointer hint. A pointer hold inside a clickable Products
    // row belongs to row selection, while touch still uses press-and-hold.
    // Promise only the gesture every pointer copy trigger answers.
    hint: String(t('copy_hint', 'Double-click to copy') || 'Double-click to copy'),
  }), [t])

  useEffect(() => { ensureTextAffordances(labels) }, [labels])

  return useMemo(() => (value: unknown): CopyFloatProps => {
    const text = String(value ?? '').trim()
    // An empty field gets no affordance rather than a gesture that opens an
    // empty panel.
    if (!text) return {}
    return { [COPY_ATTR]: text, 'data-copy-success': labels.copied, title: labels.hint, tabIndex: 0, role: 'button', 'aria-label': `${labels.copy}: ${text}` }
  }, [labels])
}

export default useCopyFloat
