import assert from 'node:assert/strict'
import { fuzzyTextMatches } from '../src/utils/searchMatch.ts'

// Part 111 follow-up: CustomersTab.tsx/SuppliersTab.tsx/DeliveryTab.tsx's
// own client-side `filteredBySearch` re-filter used to be a literal
// `.toLowerCase().includes(query)` chain per field -- the same "client
// re-filter must stay at least as permissive as the server's own match
// set, never stricter" bug class already documented (and already fixed)
// on Products.tsx/POS.tsx/Sales.tsx/Returns.tsx, but these three contact
// tabs were never brought in line even after routes/contacts.ts moved onto
// customers_fts/suppliers_fts/delivery_contacts_fts (part 108). This test
// locks in the fix (fuzzyTextMatches over a joined haystack) against the
// exact kinds of queries a naive `.includes()` chain would have wrongly
// hidden even though the server's own FTS5 search would have found them.

// Word-order independence (e.g. someone typing surname-first) --
// customers_fts/suppliers_fts/etc. don't require field words in stored
// order, a plain `.includes()` chain never handled this at all.
assert.equal(
  fuzzyTextMatches('Sokha Dara', 'dara sokha'),
  true,
  'word-reordered query should still match, same as the server FTS5 search',
)

// Diacritic tolerance (a typed "creme" should find a stored "Crème").
assert.equal(
  fuzzyTextMatches('Crème Beauty Supplier', 'creme beauty'),
  true,
  'diacritic-insensitive query should still match',
)

// Typo tolerance -- a `.includes()` chain has zero tolerance for this.
assert.equal(
  fuzzyTextMatches('Chanlina Meas chanlina@example.com', 'chanlna'),
  true,
  'a small typo should still match via bounded edit-distance fallback',
)

// Joiner/punctuation variance (phone numbers, company names).
assert.equal(
  fuzzyTextMatches('012-345-678', '012 345 678'),
  true,
  'joiner punctuation vs plain spacing should still match',
)

// Sanity: an unrelated query should NOT match (the fix must not become
// "match everything").
assert.equal(
  fuzzyTextMatches('Sokha Dara 012-345-678', 'nissan altima'),
  false,
  'a genuinely unrelated query should not match',
)

// Sanity: an exact substring still matches (baseline behavior preserved).
assert.equal(
  fuzzyTextMatches('Global Supply Co', 'global supply'),
  true,
  'a plain correctly-typed substring should still match, same as before',
)

console.log('contactSearchFilter tests passed')
