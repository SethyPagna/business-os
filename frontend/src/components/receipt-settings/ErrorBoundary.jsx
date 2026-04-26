import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('[ReceiptSettings][ErrorBoundary] caught error', error, info)
  }
  render() {
    if (this.state.error) {
      const e = this.state.error
      return (
        <div className="p-4">
          <h3 className="text-lg font-semibold text-red-600">Receipt Settings failed to load</h3>
          <p className="text-sm text-gray-600 mt-2">An unexpected error occurred while rendering this page. Details shown below for debugging.</p>
          <pre className="mt-3 p-2 bg-gray-100 rounded text-xs text-red-700 overflow-auto">{String(e && (e.stack || e.message || e))}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
