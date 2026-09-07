import { useEffect, useRef, useState } from 'react'
import { checkContactDuplicate } from './contactDuplicates'
import type { ContactDuplicateCheck, ContactTableKind } from './contactDuplicates'

const DEBOUNCE_MS = 500

// Debounced live-typing duplicate check for a contact form's name/phone
// fields -- shared by CustomerFormModal, SupplierForm, and DeliveryForm so
// the three forms flag the same way instead of each growing its own copy.
// Purely advisory: the actual block/allow decision is re-made server-side
// on every save regardless of what this hook returns (see routes/
// contacts.ts), so a stale value here can never let a real conflict slip
// through unflagged -- it can only under-flag while someone is still
// mid-typing.
export function useContactDuplicateFlag(
  table: ContactTableKind,
  name: string,
  phones: string[],
  excludeId?: number | string | null,
): ContactDuplicateCheck {
  const [result, setResult] = useState<ContactDuplicateCheck>({
    matches: [],
    duplicateReview: { candidateIds: [], candidateVersions: [], fingerprint: 'v1|' },
    allowedActions: [],
  })
  const requestIdRef = useRef(0)
  const phoneKey = phones.map((phone) => phone.trim()).filter(Boolean).join('\u0000')

  useEffect(() => {
    const trimmedName = name.trim()
    const trimmedPhones = phones.map((phone) => phone.trim()).filter(Boolean)
    if (!trimmedName && !trimmedPhones.length) {
      setResult({ matches: [], duplicateReview: { candidateIds: [], candidateVersions: [], fingerprint: 'v1|' }, allowedActions: [] })
      return undefined
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const timer = window.setTimeout(() => {
      void checkContactDuplicate(table, { name: trimmedName, phones: trimmedPhones, excludeId }).then((nextResult) => {
        if (requestIdRef.current === requestId) setResult(nextResult)
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [table, name, phoneKey, excludeId])

  return result
}
