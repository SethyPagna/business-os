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
    return (
      <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div className="bg-white dark:bg-gray-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto p-4">
          <Suspense fallback={null}>
            <ImportHub
              t={t}
              onUseClassic={() => setScreen('classic')}
              onClose={() => { onDone(); onClose() }}
            />
          </Suspense>
        </div>
      </div>
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
