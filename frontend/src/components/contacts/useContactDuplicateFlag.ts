import { useEffect, useRef, useState } from 'react'
import { checkContactDuplicate } from './contactDuplicates'
import type { ContactDuplicateMatch, ContactTableKind } from './contactDuplicates'

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
  phone: string,
  excludeId?: number | string | null,
): ContactDuplicateMatch[] {
  const [matches, setMatches] = useState<ContactDuplicateMatch[]>([])
  const requestIdRef = useRef(0)

  useEffect(() => {
    const trimmedName = name.trim()
    const trimmedPhone = phone.trim()
    if (!trimmedName && !trimmedPhone) {
      setMatches([])
      return undefined
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const timer = window.setTimeout(() => {
      void checkContactDuplicate(table, { name: trimmedName, phone: trimmedPhone, excludeId }).then((result) => {
        if (requestIdRef.current === requestId) setMatches(result)
      })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [table, name, phone, excludeId])

  return matches
}
