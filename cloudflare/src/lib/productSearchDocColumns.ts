// The two products columns of the stored search document (migration 0233).
// Kept import-light (searchCore only) because every product writer uses it.
// See lib/productSearchDoc.ts for how the document is kept complete.

import { docTerms, SEARCH_DOC_VERSION } from './searchCore'

export interface ProductSearchDocColumns {
  search_doc: string
  search_doc_version: number
}

// The document is a pure function of name and brand: a writer that knows both
// sets these two columns in the same statement as the text.
export function productSearchDocColumns(name: unknown, brand: unknown): ProductSearchDocColumns {
  return { search_doc: docTerms({ id: 0, name, brand }), search_doc_version: SEARCH_DOC_VERSION }
}
