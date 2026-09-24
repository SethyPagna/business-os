import { useEffect, useRef, useState } from 'react'
import { captureActorReadScope, isActorReadScopeCurrent } from '../../../api/actorReadScope.ts'
import { getBusinessSummarySalesPage } from '../../../api/reportsTransport.ts'
import type { QueryParams } from '../../../api/query.ts'
import { downloadCSV } from '../../../utils/csv.ts'
import { openPrintExport } from '../../../utils/exportOptions.ts'
import { collectSalesExport, saleExportObjects, saleExportPrint, saleExportWorksheet, SalesExportError, type CompletedSalesExport, type SalesExportDocument } from './salesReportExport.ts'

/** One screen-owned generation: never retain a completed report across filters,
 * account changes, display changes, permission revocation or a newer request. */
export function useSalesListExport(input: {
  key: string
  query: QueryParams
  canExport: () => boolean
  document: (result: CompletedSalesExport) => SalesExportDocument
}) {
  const currentInput = useRef(input)
  currentInput.current = input
  const lifecycle = useRef({ key: input.key, generation: 0, mounted: true })
  if (lifecycle.current.key !== input.key) {
    lifecycle.current.key = input.key
    lifecycle.current.generation++
  }
  const [state, setState] = useState<{ key: string; generation: number; busy?: boolean; document?: SalesExportDocument; current?: () => boolean; error?: unknown }>({ key: input.key, generation: 0 })
  useEffect(() => {
    lifecycle.current.mounted = true
    return () => { lifecycle.current.mounted = false; lifecycle.current.generation++ }
  }, [])
  const relevant = state.key === input.key && state.generation === lifecycle.current.generation
  const fail = (error: unknown) => setState({ key: currentInput.current.key, generation: lifecycle.current.generation, error })
  const failOwned = (error: unknown, generation: number) => {
    if (lifecycle.current.mounted && generation === lifecycle.current.generation) fail(error)
  }
  const prepare = async () => {
    const request = currentInput.current
    const generation = ++lifecycle.current.generation
    const scope = captureActorReadScope('reports:sales')
    const current = () => lifecycle.current.mounted && generation === lifecycle.current.generation
      && lifecycle.current.key === request.key && isActorReadScopeCurrent(scope) && currentInput.current.canExport()
    setState({ key: request.key, generation, busy: true })
    try {
      const result = await collectSalesExport(request.query, getBusinessSummarySalesPage, current)
      const document = request.document(result)
      if (!current()) throw new SalesExportError('unavailable')
      setState({ key: request.key, generation, document, current })
    } catch (error) {
      if (lifecycle.current.mounted && generation === lifecycle.current.generation) fail(error)
    }
  }
  const requireDocument = () => {
    if (!relevant || !state.document || !state.current?.()) throw new SalesExportError('unavailable')
    return { document: state.document, current: state.current }
  }
  const csv = () => {
    try {
      const { document, current } = requireDocument()
      const rows = saleExportObjects(document, true)
      if (!current()) throw new SalesExportError('unavailable')
      downloadCSV(`${document.filename}.csv`, rows)
    } catch (error) { failOwned(error, state.generation) }
  }
  const excel = async () => {
    const generation = state.generation
    try {
      const { document, current } = requireDocument()
      const { downloadTypedWorkbook } = await import('../../../utils/xlsxExport.ts')
      if (!current()) throw new SalesExportError('unavailable')
      downloadTypedWorkbook(`${document.filename}.xlsx`, saleExportWorksheet(document), current)
    } catch (error) { failOwned(error, generation) }
  }
  const print = () => {
    const generation = state.generation
    try {
      const { document, current } = requireDocument()
      const allowed = () => {
        const valid = current()
        if (!valid) failOwned(new SalesExportError('unavailable'), generation)
        return valid
      }
      // A fresh preview-button gesture: no network or dynamic import before
      // the popup/iframe opens. Both surfaces recheck after their font wait.
      if (!allowed() || !openPrintExport(saleExportPrint(document), allowed)) throw new SalesExportError('unavailable')
    } catch (error) { failOwned(error, generation) }
  }
  const close = () => { lifecycle.current.generation++; setState({ key: input.key, generation: lifecycle.current.generation }) }
  return { prepare, csv, excel, print, close, busy: relevant && !!state.busy,
    document: relevant && state.current?.() ? state.document : undefined, error: relevant ? state.error : undefined }
}
