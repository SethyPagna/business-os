import { useEffect, useMemo } from 'react'
import { COPY_ATTR, ensureTextAffordances, type AffordanceLabels } from './textAffordances.ts'

// Widest shape the surfaces in this lane actually pass: the two product
// detail modals hand over a two-argument `T(key, fallback)`, the Products
// list a three-argument `tr(key, fallback, khmerFallback)`.
type Translate = (key: string, fallback: string, khmerFallback?: string) => string | undefined

export type CopyFloatLabels = AffordanceLabels & { hint: string }

/** Attributes that turn any element into a copy-float trigger. */
export type CopyFloatProps = Record<string, string> | Record<string, never>

// Copy affordance for a product's NAME, BRAND, SUPPLIER and BARCODE:
// double-click on a pointer device, press-and-hold on touch, both opening
// the one shared float with the full value and a Copy button.
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
    hint: String(t('copy_hint', 'Double-click or hold to copy') || 'Double-click or hold to copy'),
  }), [t])

  useEffect(() => { ensureTextAffordances(labels) }, [labels])

  return useMemo(() => (value: unknown): CopyFloatProps => {
    const text = String(value ?? '').trim()
    // An empty field gets no affordance rather than a gesture that opens an
    // empty panel.
    if (!text) return {}
    return { [COPY_ATTR]: text, title: labels.hint }
  }, [labels])
}

export default useCopyFloat
