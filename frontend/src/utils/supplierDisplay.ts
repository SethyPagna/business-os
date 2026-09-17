// Owner (Sep 17): "i see that some items have no supplier. I want you to make
// it 'No supplier' for supplier".
//
// A missing supplier is a FACT about the item, not an absence to be decoded.
// Before this the same blank showed as '--', '-', an em dash, the word
// "Unknown", or nothing at all (the chip was dropped from the row), so an
// operator could not tell "nobody recorded a supplier" from "this surface does
// not show suppliers". One key, one label, every surface.
//
// The key keeps its historical name; only the wording the owner asked for
// changed, so no call site outside this file needs to know the key at all.
export const NO_SUPPLIER_KEY = 'no_supplier_recorded'
export const NO_SUPPLIER_FALLBACK = 'No supplier'

export type SupplierLabelLookup = (key: string, fallback: string) => string

export function supplierDisplay(name: unknown, tr: SupplierLabelLookup): string {
  const text = String(name ?? '').trim()
  return text || tr(NO_SUPPLIER_KEY, NO_SUPPLIER_FALLBACK)
}

// True when the value the surface holds is not a recorded supplier, so a row
// can style the placeholder differently from a real name without repeating the
// blank/whitespace rule.
export function hasSupplier(name: unknown): boolean {
  return String(name ?? '').trim().length > 0
}
