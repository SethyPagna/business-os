// A bare host for the REAL useActionHistory hook, for tests that mount it through mountedComponentHarness.ts
// (component: '../tests/actionHistoryHost.ts'). It renders one button per hook action and nothing else, so a test
// drives push / undo / redo / the recorded-list Undo exactly as the page bars do, without a whole page around it.
import { createElement, type ReactElement } from 'react'
import { useActionHistory } from '../src/utils/actionHistory.ts'

type HostProps = {
  notify: (message: string, type?: string) => void
  user: Record<string, unknown>
  entry: { label: string; undo: () => unknown; redo: () => unknown }
  recordedServerId?: number
}

export default function ActionHistoryHost({ notify, user, entry, recordedServerId }: HostProps): ReactElement {
  const history = useActionHistory({ limit: 5, notify, scope: 'fixture', enabled: true, user })
  const button = (name: string, onClick: () => unknown): ReactElement => createElement('button', { key: name, type: 'button', 'aria-label': name, onClick }, name)
  return createElement('div', null,
    button('load', () => history.requestServerItems()),
    button('push', () => history.pushAction({ label: entry.label, undo: entry.undo, redo: entry.redo })),
    button('undo', () => history.undo()),
    button('redo', () => history.redo()),
    button('undo-recorded', () => history.undoServer(recordedServerId ?? 0, 'Undone')),
    createElement('output', { key: 'state', 'data-state': '' }, JSON.stringify({
      canUndo: history.canUndo, canRedo: history.canRedo, busy: history.busy, recorded: history.serverItems.map((item) => `${item.id}:${item.status}`),
    })),
  )
}
