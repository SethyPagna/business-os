import { useApp as useAppHook } from '../../../AppContext.jsx'

const useApp = useAppHook as () => {
  t: (key: string) => string
}

export default function NoData() {
  const { t } = useApp()
  return (
    <div className="flex items-center justify-center py-10 text-gray-400 text-sm">
      {t('no_data_for_period') || 'No data for this period'}
    </div>
  )
}
