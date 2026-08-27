// Thin owner for the product import mode. The old version rendered a full
// mode/options/template/upload screen and then opened a second modal that
// repeated those controls. The real importer now owns Screen 1; this wrapper
// only switches which real importer is mounted.
import { Suspense, useState } from 'react'
import { lazyRetry } from '../../../utils/lazyImport.ts'
import type { ProductImportTopMode } from './ProductImportModeTabs'

const BulkImportModal = lazyRetry(() => import('./BulkImportModal'), 'products-bulk-import')
const StockActionImportModal = lazyRetry(() => import('./StockActionImportModal'), 'products-stock-action-import')

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
