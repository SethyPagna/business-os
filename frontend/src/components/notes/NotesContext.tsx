import { createContext, useContext, type ReactNode } from 'react'
import { useNotesController } from './useNotesController.ts'

// Fixes: "notes page and tab are not working in sync" -- NotesPage.tsx and
// NotesWidget.tsx each used to call useNotesController() directly, and a
// React hook has no memory of other components calling the same hook --
// each call creates its own independent `notes`/`activeId`/`loaded` state.
// So the floating widget and the full Notes page were silently keeping two
// separate copies of "the same" note list: creating or editing a note in
// one never touched the other's state, and it only ever looked "synced" if
// one of the two happened to unmount and remount (forcing a fresh fetch).
//
// Fix: run useNotesController() exactly once, here, and have both callers
// read from this context instead of calling the hook themselves. Both
// notes are still per-user server-side (routes/notes.ts scopes every query
// to the logged-in user's own id) -- this only fixes the frontend having
// two disconnected local copies of that same per-user data.

type NotesControllerValue = ReturnType<typeof useNotesController>

const NotesContext = createContext<NotesControllerValue | null>(null)

export function NotesProvider({ children }: { children: ReactNode }) {
  const controller = useNotesController()
  return <NotesContext.Provider value={controller}>{children}</NotesContext.Provider>
}

export function useNotes(): NotesControllerValue {
  const ctx = useContext(NotesContext)
  if (!ctx) {
    throw new Error('useNotes() must be called within <NotesProvider>. NotesWidget and NotesPage both rely on this shared provider being mounted once, above both of them, in App.tsx so they see the same note list.')
  }
  return ctx
}
