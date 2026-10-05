// The Telegram alert for a product edit made by anyone who is not an administrator (owner, 5 Oct 2026:
// every employee product edit leaves a Record AND an alert). Pure: no imports, so the route and its tests
// load the same code. The route sends it through sendTelegramEvent (bilingual, the Alerts topic); the Record
// is the audit row the edit already writes. Cost is never named: the audit diff excludes it and an employee
// cannot change it.

export const PRODUCT_EDIT_ALERT_HEADING = '✏️ Product edited'

// Column -> the short word the alert prints. Anything not listed prints its column name.
const FIELD_WORDS: Record<string, string> = {
  name: 'name', barcode: 'barcode', brand: 'brand', category: 'category', unit: 'unit',
  image_path: 'image', image_gallery: 'images', description: 'description', is_active: 'status',
  selling_price_usd: 'selling price', selling_price_khr: 'selling price', wholesale_price_usd: 'wholesale price', wholesale_price_khr: 'wholesale price',
}

/** The distinct words for the changed columns, in order; cost columns are never named. */
export function productEditAlertFields(columns: readonly string[], imagesChanged = false): string[] {
  const words: string[] = []
  for (const column of [...columns, ...(imagesChanged ? ['image_gallery'] : [])]) {
    if (/cost|purchase_price/i.test(column)) continue
    const word = FIELD_WORDS[column] || column.replace(/_/g, ' ')
    if (!words.includes(word)) words.push(word)
  }
  return words
}

export function formatProductEditAlertLines(input: { product: string; changed: readonly string[]; by?: string | null }): string[] {
  return [
    `Product: ${input.product}`,
    input.changed.length ? `Changed: ${input.changed.join(', ')}` : '',
    input.by ? `By: ${input.by}` : '',
  ]
}
