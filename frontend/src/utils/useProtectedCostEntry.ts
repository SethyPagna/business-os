import { useRef, useState } from 'react'

// Readable drafts remain in their owning form. Blind entries are separate,
// short-lived and scoped to this actor, entity and capability generation.
export function useProtectedCostEntry(actorId: unknown, entityId: unknown, canView: boolean, canEdit: boolean) {
  const owner = useRef(String(actorId ?? ''))
  const key = JSON.stringify([actorId ?? '', entityId ?? '', canView, canEdit])
  const generation = useRef({ key, value: 0 })
  if (generation.current.key !== key) generation.current = { key, value: generation.current.value + 1 }
  const scope = generation.current.value
  const [entry, setEntry] = useState<{ scope: number; values: Record<string, string | boolean> }>({ scope, values: {} })
  const readable = canView && owner.current === String(actorId ?? '')
  const value = <T extends string | number | boolean>(name: string, protectedValue: T, empty: T): T | string | boolean => (
    readable ? protectedValue : entry.scope === scope ? entry.values[name] ?? empty : empty
  )
  const write = (name: string, next: string | boolean) => {
    if (!canEdit) return
    setEntry((current) => ({ scope, values: { ...(current.scope === scope ? current.values : {}), [name]: next } }))
  }
  return { readable, value, write }
}
