import { Component, type ErrorInfo, type ReactNode } from 'react'
import { reportClientCrash } from '../../utils/clientCrashReport.ts'

// The LAST boundary: it mounts above the providers in AdminRoot.tsx and
// PublicCatalogRoot.tsx, so it still catches when AppProvider itself throws
// during its first render. Without it a single throw in a provider (the
// storefront's useRef initializer touching window.sessionStorage on an iOS
// device with "Block All Cookies" -- see readPortalCache() in
// PublicCatalogPage.tsx) unmounted the whole tree and left a blank white page
// with nothing on screen and no way back except force-quitting the PWA.
//
// Three deliberate constraints, all because of WHERE this renders:
//
// 1. No lang-pack lookup. The packs are loaded by the very providers this
//    boundary sits above, so t() may not exist yet. The English and Khmer
//    copy below is therefore hard-coded -- the one place in the app where
//    that is correct rather than a missing translation.
// 2. Inline styles, not classes. If the CSS bundle is what failed to load,
//    class names style nothing and the user would be staring at an unstyled
//    or invisible page. Khmer needs more vertical room than Latin, so the
//    line boxes here are sized with explicit line-height, not a Latin default.
// 3. Never silent. The error is logged to the console AND posted to the
//    Worker through the same /api/system/client-error path PageErrorBoundary
//    uses (App.tsx:1072-1093), so a blank-page report is never invisible.
// 4. Reload is the ONLY recovery here, and only the person can trigger it.
//    The button calls location.reload() and nothing else: it never clears
//    storage and never unregisters the service worker, so a queued offline
//    sale and any cart/form draft survive pressing it. It also never reloads
//    by itself, which is what keeps it out of the way of the chunk-load
//    recovery in App.tsx:445-478 (triggerChunkRecoveryReload). A stale-deploy
//    chunk failure is caught BELOW this boundary, by PageErrorBoundary and
//    lazyImport, which own the offline check, the hasDirtyWork() check and
//    the one-reload-per-build guard in utils/chunkReloadGuard.ts. Anything
//    that reaches THIS boundary has already been declined or missed by that
//    path, so an automatic reload here would only double-handle it and risk
//    the reload loop that guard exists to prevent.

interface RootErrorBoundaryProps {
  /** Identifies the failing root in the crash report: 'admin-root' | 'public-catalog-root'. */
  surface: string
  children: ReactNode
}

interface RootErrorBoundaryState {
  error: Error | null
}

const panelStyle = {
  // The viewport a phone can actually show (styles/main.css --app-vh), with the
  // plain-vh fallback because this panel must still render when the CSS
  // bundle is exactly what failed to load and --app-vh therefore does not exist.
  minHeight: 'calc(100 * var(--app-vh, 1vh))',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  backgroundColor: '#f8fafc',
  color: '#0f172a',
  fontFamily: "'Noto Sans Khmer', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const

const cardStyle = {
  width: '100%',
  maxWidth: '440px',
  borderRadius: '16px',
  border: '1px solid #e2e8f0',
  backgroundColor: '#ffffff',
  padding: '20px',
  boxShadow: '0 10px 25px rgba(15, 23, 42, 0.08)',
} as const

// 1.9 line-height on every text line: Khmer stacks diacritics above and below
// the base glyph, and a Latin-sized line box clips them.
const titleStyle = { margin: '0 0 4px', fontSize: '18px', fontWeight: 700, lineHeight: 1.9 } as const
const khmerTitleStyle = { margin: '0 0 12px', fontSize: '16px', fontWeight: 600, lineHeight: 1.9, color: '#334155' } as const
const bodyStyle = { margin: '0 0 4px', fontSize: '14px', lineHeight: 1.9, color: '#475569' } as const
const detailStyle = {
  margin: '12px 0 16px',
  padding: '10px 12px',
  borderRadius: '10px',
  backgroundColor: '#f1f5f9',
  color: '#334155',
  fontSize: '12px',
  lineHeight: 1.7,
  wordBreak: 'break-word',
} as const
const buttonStyle = {
  width: '100%',
  minHeight: '48px',
  borderRadius: '10px',
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  fontSize: '15px',
  fontWeight: 600,
  lineHeight: 1.9,
  cursor: 'pointer',
} as const

export default class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  constructor(props: RootErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[RootErrorBoundary] "${this.props.surface}" failed to mount:`, error?.message, info?.componentStack)
    // Fire-and-forget with its own catch inside: a failure to REPORT a crash
    // must never become a second crash inside the handler already dealing
    // with one. Same contract as PageErrorBoundary's reporting call.
    void reportClientCrash(error, this.props.surface)
  }

  handleReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const name = String(error?.name || 'Error')
    const message = String(error?.message || error || '').slice(0, 300)

    return (
      <div style={panelStyle} role="alert" data-root-error-boundary={this.props.surface}>
        <div style={cardStyle}>
          <p style={titleStyle}>The app could not start</p>
          <p style={khmerTitleStyle}>កម្មវិធីមិនអាចចាប់ផ្តើមបានទេ</p>
          <p style={bodyStyle}>Reload to try again.</p>
          <p style={{ ...bodyStyle, margin: '0' }}>សូមផ្ទុកឡើងវិញ ដើម្បីព្យាយាមម្ដងទៀត។</p>
          <p style={detailStyle}>{name}: {message}</p>
          <button type="button" style={buttonStyle} onClick={this.handleReload}>
            Reload / ផ្ទុកឡើងវិញ
          </button>
        </div>
      </div>
    )
  }
}
