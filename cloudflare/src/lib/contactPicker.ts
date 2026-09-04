// `fields=picker` shape for the contact list routes (GET /customers,
// /suppliers, /delivery-contacts -- see routes/contacts.ts's
// registerContactRoutes).
//
// Why this exists: the only "give me a usable copy of the contacts" shape
// this endpoint had was the unpaged default -- SELECT * over every row,
// and for customers a per-row loyalty aggregation on top (routes/
// contacts.ts's withPoints). The offline device snapshot took exactly that
// shape every time it ran, so a device downloaded the whole customers
// table, columns and computed balances included, to back a picker that
// shows a name, a phone and a membership number.
//
// `fields=picker` answers that question directly: picker/receipt columns
// only -- never notes/company, never the aggregation -- and never more
// than `limit` rows.
//
// It lives in its own module (like lib/contactIds.ts) so the SQL can be
// run for real against a migrated SQLite database in
// scripts/test-customer-list-filters-pure.cjs instead of being asserted as
// a string.

export type ContactPickerTable = 'customers' | 'suppliers' | 'delivery_contacts'

// The default is sized for a whole small business's active customers; the
// ceiling exists so no caller can turn this back into the unbounded read
// it replaces.
export const CONTACT_PICKER_DEFAULT_LIMIT = 2000
export const CONTACT_PICKER_MAX_LIMIT = 5000

// Exactly what a picker row and a receipt line need, and nothing else.
// `updated_at` is here because the client mirrors these rows and the
// expected-updated_at write guard (frontend expectedUpdatedAt.ts) reads it
// back; `created_at` because the contacts list surfaces a joined date.
export const CONTACT_PICKER_COLUMNS: Record<ContactPickerTable, string[]> = {
  customers: ['id', 'name', 'phone', 'email', 'address', 'membership_number', 'gender', 'created_at', 'updated_at'],
  suppliers: ['id', 'name', 'phone', 'email', 'address', 'created_at', 'updated_at'],
  delivery_contacts: ['id', 'name', 'phone', 'area', 'address', 'created_at', 'updated_at'],
}

/**
 * Customers: most recently active first, so a bounded copy keeps the people
 * who actually buy. The correlated MAX() is one covering-index seek per row
 * (idx_sales_customer_created, migrations/0086_missing_fk_indexes.sql).
 * Other tables have no such activity index and stay name-ordered. `id`
 * breaks every tie so the cut at `limit` is deterministic -- two calls with
 * the same data must return the same rows, or a mirror would flap.
 */
export function buildContactPickerSql(table: ContactPickerTable): string {
  const columns = CONTACT_PICKER_COLUMNS[table].join(', ')
  if (table === 'customers') {
    return `SELECT ${columns}, (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = customers.id) AS last_sale_at `
      + `FROM customers ORDER BY last_sale_at DESC NULLS LAST, lower(name) ASC, id ASC LIMIT @limit`
  }
  return `SELECT ${columns} FROM ${table} ORDER BY lower(name) ASC, id ASC LIMIT @limit`
}
