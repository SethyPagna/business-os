// Reads the "Official Product Name" section out of a product's `description`
// text -- there is no `official_name` DB column (grepped every migration;
// confirmed by the coordinator's Gate-1 audit). The value lives as one
// labelled section inside the free-text `description` column alongside up
// to four others (Introduction, Features & Benefits, Who is it for?,
// Ingredients -- cloudflare/src/lib/productDescriptionSections.ts
// SECTION_ORDER), written as `Official Product Name:\n<value>` and joined
// with the other present sections by a blank line.
//
// This is a minimal, read-only port of the label-matching rule in
// frontend/src/components/catalog/productDetailSections.ts's
// parseProductDescription (that file's own header explains why matching
// against the description text is the only option: no schema for this
// today). Only the official_name extraction is ported -- this tool never
// needs the other sections -- and it is intentionally read-only: this
// workflow never writes a description (see README.md's "what this does not
// do"), so there is no write-side port to keep in sync.
const LABEL_PATTERN = /(^|\n)\s*official\s+product\s+name\s*\??\s*[:\-]\s*/gi

export function extractOfficialNameFromDescription(description) {
  const text = String(description ?? '').trim()
  if (!text) return ''
  const matches = [...text.matchAll(LABEL_PATTERN)]
  if (!matches.length) return ''
  // If the label appears more than once (malformed data), the parser this
  // ports from reads whichever occurrence comes first and stops there.
  const match = matches[0]
  const start = match.index + match[0].length
  // The section ends at the next recognised label line or end of text.
  // Sibling labels (Introduction/Features & Benefits/Who is it for?/
  // Ingredients) all start a line with `Label:` or `Label -`; a generic cut
  // at the next blank-line-preceded capitalised label keeps this simple
  // without re-porting the full label table for a read-only helper.
  const rest = text.slice(start)
  const nextLabel = rest.search(/\n\s*(introduction|features\s*&?\s*benefits|features\s+and\s+benefits|who\s+is\s+it\s+for\??|ingredients)\s*\??\s*[:\-]/i)
  return (nextLabel === -1 ? rest : rest.slice(0, nextLabel)).trim()
}
