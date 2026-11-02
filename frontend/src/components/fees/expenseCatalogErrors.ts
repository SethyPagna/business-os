// What the Worker's label and type catalog refuses with (routes/feesCatalog.ts, routes/fees.ts), put into the operator's language.
// The server's own sentence is English and follows only when its code is not one of these.

export type CatalogTranslate = (key: string, fallback: string) => string

const CODE_TEXT: Record<string, [key: string, fallback: string]> = {
  label_exists: ['expense_err_label_exists', 'That label already exists.'],
  label_archived: ['expense_err_label_archived', 'That label is archived. Restore it first.'],
  label_not_found: ['expense_err_label_not_found', 'That label no longer exists.'],
  label_required: ['expense_err_label_required', 'A label is required.'],
  label_too_long: ['expense_err_label_too_long', 'A label is a short tag: up to 6 words and 60 characters.'],
  type_exists: ['expense_err_type_exists', 'That type already exists.'],
  type_builtin: ['expense_err_type_builtin', 'Built-in types cannot be changed.'],
  type_not_found: ['expense_err_type_not_found', 'That type is not in the list.'],
  type_name_invalid: ['expense_err_type_invalid', 'A type name is 1 to 40 characters.'],
  fee_type_invalid: ['expense_err_type_invalid', 'A type name is 1 to 40 characters.'],
  fee_type_archived: ['expense_err_type_archived', 'That type is archived. Choose an active type.'],
}

/** The translated sentence for a refusal the catalog is known to send, or null for anything else. */
export function catalogRefusalText(error: unknown, tr: CatalogTranslate): string | null {
  const code = String((error as { code?: unknown } | null)?.code || '')
  const known = Object.hasOwn(CODE_TEXT, code) ? CODE_TEXT[code] : null
  return known ? tr(known[0], known[1]) : null
}

/** "<what failed>: <why>" -- the why is the translated refusal when its code is known, else the server's message. */
export function catalogFailureText(error: unknown, tr: CatalogTranslate, key: string, fallback: string): string {
  const head = tr(key, fallback)
  const why = catalogRefusalText(error, tr) ?? (error instanceof Error ? error.message : '')
  return why ? `${head}: ${why}` : head
}
