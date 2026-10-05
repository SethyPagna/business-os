import { Component, type ErrorInfo, type ReactNode } from 'react'

// Owner, 5 Oct 2026: "a Settings page once went blank after saving".
//
// Settings had no boundary of its own, so a render error inside any section
// (the form rehydrates and every preview re-runs after a save) reached the
// shell's PageErrorBoundary, whose fallback replaces the WHOLE page -- the Save
// row, the section tabs and the person's unsaved form state with it. The form's
// state lives in Settings itself, above this boundary, so when a section fails
// to render only that block is replaced and everything the person typed is still
// there to save once the block shows again.
interface SettingsRenderBoundaryProps {
  children: ReactNode
  message: string
  actionLabel: string
  // A change of this value (switching section tab, a fresh settings load) clears
  // the failure and tries to render the sections again.
  resetKey?: string
}

interface SettingsRenderBoundaryState {
  error: Error | null
}

export function describeRenderFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error || '')
}

export default class SettingsRenderBoundary extends Component<SettingsRenderBoundaryProps, SettingsRenderBoundaryState> {
  state: SettingsRenderBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): SettingsRenderBoundaryState {
    return { error: error instanceof Error ? error : new Error(describeRenderFailure(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Settings] a section failed to render:', error.message, info.componentStack)
  }

  componentDidUpdate(previous: SettingsRenderBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
        <p className="font-medium">{this.props.message}</p>
        <p className="mt-1 break-words font-mono text-xs opacity-80">{describeRenderFailure(this.state.error)}</p>
        <button type="button" className="btn-secondary mt-3 text-xs" onClick={() => this.setState({ error: null })}>
          {this.props.actionLabel}
        </button>
      </div>
    )
  }
}
