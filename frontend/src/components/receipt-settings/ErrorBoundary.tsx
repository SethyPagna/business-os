import React from 'react'

type ErrorBoundaryProps = {
  children: React.ReactNode
}

type ErrorBoundaryState = {
  error: unknown
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message
  }
  return String(error)
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ReceiptSettings][ErrorBoundary] caught error', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4">
          <h3 className="text-lg font-semibold text-red-600">Receipt Settings failed to load</h3>
          <p className="text-sm text-gray-600 mt-2">An unexpected error occurred while rendering this page. Details shown below for debugging.</p>
          <pre className="mt-3 p-2 bg-gray-100 rounded text-xs text-red-700 overflow-auto">{formatError(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
