// DELETE /api/delivery-contacts/:id answers 409 { code: 'contact_has_sales' } for a delivery person a sale or delivery fee still names.
// Every surface that deletes one (the delete button, undo of an add, redo of a delete, bulk delete and its redo) shows the translated
// sentence, never the server's English text.
export const DELIVERY_HAS_SALES_CODE = 'contact_has_sales'

type Translate = (key: string, fallback: string) => string

export function isDeliveryHasSalesRefusal(error: unknown): boolean {
  return Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === DELIVERY_HAS_SALES_CODE
}

// The same refusal with the translated message (code and status kept); any other error is returned unchanged.
export function localizeDeliveryHasSalesRefusal<E>(error: E, tr: Translate): E | Error {
  if (!isDeliveryHasSalesRefusal(error)) return error
  const original = error as unknown as { message?: unknown; status?: unknown }
  return Object.assign(new Error(tr('delivery_contact_has_sales', String(original.message || ''))), { code: DELIVERY_HAS_SALES_CODE, status: original.status })
}

// "Deleted 3, 2 not deleted." plus, when any refusal was the has-sales one, what to do instead.
export function deliveryBulkDeleteMessage(tr: Translate, deleted: number, notDeleted: number, anyOnSales: boolean): string {
  const head = tr('delivery_contacts_bulk_partial', 'Deleted {deleted}, {failed} not deleted.')
    .replace('{deleted}', String(deleted)).replace('{failed}', String(notDeleted))
  return anyOnSales ? `${head} ${tr('delivery_contact_has_sales', '')}`.trim() : head
}
