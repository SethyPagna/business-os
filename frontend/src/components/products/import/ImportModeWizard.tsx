// Thin owner for the product import mode. The old version rendered a full
// mode/options/template/upload screen and then opened a second modal that
// repeated those controls. The real importer now owns Screen 1; this wrapper
// only switches which real importer is mounted.
//
// N1c (Part 402): the FIRST screen is now the Import Hub -- drop one file
// or many, each recognized by its real header shape and queued into its
// own reviewed job (all seven engines share the create->upload->analyze
// pipeline, so the hub adds routing, not new commit paths). The classic
// per-type screens stay one click away and unchanged.
import { Suspense, useState } from 'react'
import Modal from '../../shared/Modal.tsx'
import InfoHint from '../../shared/InfoHint.tsx'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import type { ProductImportTopMode } from './ProductImportModeTabs'

const BulkImportModal = lazyRetry(() => import('./BulkImportModal'), 'products-bulk-import')
const StockActionImportModal = lazyRetry(() => import('./StockActionImportModal'), 'products-stock-action-import')
const ImportHub = lazyRetry(() => import('./ImportHub'), 'products-import-hub')

type TranslateFn = (key: string, fallback?: string, km?: string) => string

interface ImportModeWizardProps {
  onClose: () => void
  onDone: () => void
  t: TranslateFn
  products?: { id?: string | number; name?: string | null }[]
  branches?: { id: string | number; name?: string | null }[]
}

export default function ImportModeWizard({ onClose, onDone, t }: ImportModeWizardProps) {
  const [mode, setMode] = useState<ProductImportTopMode>('general')
  const [screen, setScreen] = useState<'hub' | 'classic'>('hub')

  if (screen === 'hub') {
    // Shared Modal (portalled, z-[1050]) instead of a hand-rolled z-50
    // overlay: the old sheet rendered BELOW BackgroundImportTracker's
    // chip/panel (z-[1000]), so the tracker could bury the very hub that
    // just queued the jobs. The hub's title/hint live in the Modal header
    // now (the hub itself renders body content only).
    return (
      <Modal
        title={t('import_hub_title', 'Import files')}
        headerExtra={(
          <InfoHint
            label={t('import_hub_how', 'How importing works')}
            text={t('import_hub_sub', 'Drop one combined sheet or separate files (catalog, stock-in, sales, contacts) — several at once or over sessions. Each file is recognized by its columns and imports automatically; conflicts pause for review in the import tracker.')}
          />
        )}
        onClose={() => { onDone(); onClose() }}
      >
        <Suspense fallback={null}>
          <ImportHub
            t={t}
            onUseClassic={() => setScreen('classic')}
            onClose={() => { onDone(); onClose() }}
          />
        </Suspense>
      </Modal>
    )
  }

  return (
    <Suspense fallback={null}>
      {mode === 'stock_actions' ? (
        <StockActionImportModal onClose={onClose} onDone={onDone} t={t} topMode={mode} onTopModeChange={setMode} />
      ) : (
        <BulkImportModal key={mode} onClose={onClose} onDone={onDone} t={t} topMode={mode} onTopModeChange={setMode} />
      )}
    </Suspense>
  )
}
