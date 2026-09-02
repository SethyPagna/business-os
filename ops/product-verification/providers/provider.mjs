// Provider interface. verify-products.mjs is written against this shape
// only -- it never knows or cares whether it is talking to the mock
// provider or a real search API. To add a new real provider, implement
// these two methods and wire it up in verify-products.mjs's --provider flag
// (see README.md).
//
// searchByName/searchByBarcode both return SearchHit[] (see reconcile.mjs's
// typedef) -- matchesBrand/matchesProduct/matchesVariant/proposedName
// already resolved. A provider that only has raw title/snippet/url (any
// real search API) should run each raw result through
// lib/matchAssessment.mjs's assessHit() before returning it; see
// providers/httpProvider.mjs for the reference implementation.

/**
 * @typedef {Object} SearchProvider
 * @property {string} name
 * @property {(product: import('../reconcile.mjs').ProductRow) => Promise<import('../reconcile.mjs').SearchHit[]>} searchByName
 * @property {(barcode: string, product: import('../reconcile.mjs').ProductRow) => Promise<import('../reconcile.mjs').SearchHit[]>} searchByBarcode
 */

export {}
