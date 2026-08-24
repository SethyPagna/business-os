import { apiFetch, route } from './http.ts'

// Personal, per-user autosaved notes -- a private scratchpad (see
// cloudflare/src/routes/notes.ts). No local/offline mirror: this is a
// low-stakes convenience feature, not core business data, so a failed
// save while offline just surfaces as a normal error rather than needing
// an outbox/sync story like sales or inventory writes.

export type NoteRecord = {
  id: number
  user_id: number
  title: string
  content: string
  pinned: number
  sort_order: number
  created_at: string
  updated_at: string
}

type NotePayload = {
  title?: string
  content?: string
  pinned?: boolean
  expectedUpdatedAt?: string | null
}

export function getNotes(): Promise<{ notes: NoteRecord[] }> {
  return route(
    'notes:get',
    () => apiFetch('GET', '/api/notes'),
    () => ({ notes: [] }),
    { raceLocalFallback: false },
  )
}

export function createNote(payload: NotePayload = {}): Promise<{ note: NoteRecord }> {
  return route(
    'notes:create',
    () => apiFetch('POST', '/api/notes', payload),
    null,
    true,
  )
}

export function updateNote(id: number, payload: NotePayload = {}): Promise<{ note: NoteRecord }> {
  return route(
    'notes:update',
    () => apiFetch('PUT', `/api/notes/${encodeURIComponent(String(id))}`, payload),
    null,
    true,
  )
}

// Persist a manual drag-and-drop order for the current user's notes list
// (see NotesPage.tsx). orderedIds is the full list of note ids in their
// new top-to-bottom order; the backend assigns sequential sort_order
// values to match and returns the freshly re-sorted list.
export function reorderNotes(orderedIds: number[]): Promise<{ notes: NoteRecord[] }> {
  return route(
    'notes:reorder',
    () => apiFetch('PATCH', '/api/notes/reorder', { orderedIds }),
    null,
    true,
  )
}

export function deleteNote(id: number): Promise<{ success: boolean }> {
  return route(
    'notes:delete',
    () => apiFetch('DELETE', `/api/notes/${encodeURIComponent(String(id))}`),
    null,
    true,
  )
}
