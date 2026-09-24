// The Records float for a record whose history IS the audit trail: a product,
// a customer, a supplier, a delivery contact.
//
// The owner, Sep 22 2026: "having records in sales, returns, stock changes,
// products, invoices, etc... make sure these records are having them there as
// well as in the actual audit log".
//
// "as well as in the actual audit log" is why this reads the audit endpoint
// with an entity + id filter instead of getting a route of its own: the rows a
// product's Field history shows are literally the rows the Audit Log page
// shows, through the same clause builder and the same permission gate. Two
// readers of one table cannot drift; two endpoints over one table can.
//
// Six call sites share this wrapper rather than repeating the loader, the
// adapter and the title: the entity name and the id are the only things any of
// them actually knows.
import RecordsFloat from './RecordsFloat.tsx'
import { getEntityAuditRecords } from '../../api/auditLogTransport.ts'
import { ENTITY_RECORDS_ADAPTER, auditPayloadToRecords } from '../../utils/entityRecords.ts'

interface EntityRecordsFloatProps {
  /** The audit_logs entity name: 'product', 'customer', 'supplier', ... */
  entity: string
  entityId: string | number
  /** What this record is called -- the product name, the contact name. */
  subject?: string | null
  onClose: () => void
  t: (key: string) => string
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}

export default function EntityRecordsFloat({ entity, entityId, subject, onClose, t, fmtUSD, fmtKHR }: EntityRecordsFloatProps) {
  const heading = t('field_history') || 'Field history'
  return (
    <RecordsFloat
      title={subject ? `${heading} · ${subject}` : heading}
      recordKey={`${entity}:${entityId}`}
      load={() => getEntityAuditRecords(entity, entityId).then(auditPayloadToRecords)}
      adapter={ENTITY_RECORDS_ADAPTER}
      onClose={onClose}
      t={t}
      fmtUSD={fmtUSD}
      fmtKHR={fmtKHR}
    />
  )
}
