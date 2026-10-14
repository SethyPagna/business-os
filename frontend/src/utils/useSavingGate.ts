import { useApp } from '../AppContext'

type SavingGateContext = {
  t: (key: string) => string
  canWriteToServer?: boolean
}

export function useSavingGate(): { blocked: boolean; reason: string } {
  const { t, canWriteToServer } = useApp() as SavingGateContext
  const blocked = canWriteToServer === false
  return { blocked, reason: blocked ? t('pos_saving_needs_connection') : '' }
}
