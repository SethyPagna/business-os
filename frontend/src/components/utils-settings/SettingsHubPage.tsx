import { Suspense, lazy, useState } from 'react'
import SettingsIcon from 'lucide-react/dist/esm/icons/settings.js'
import UsersIcon from 'lucide-react/dist/esm/icons/users.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import { useApp as useAppHook } from '../../AppContext.tsx'

// E4 (Part 403): Settings absorbs Users and Backup as sections of one
// page. Pure rewiring per the Phase-E contract: the three section
// components move intact with their own permission keys ('settings' /
// 'users' / 'backup'); only the standalone users/backup PAGE ids retire,
// and their old URLs land here with the right section open.

const SettingsSection = lazy(() => import('./Settings'))
const UsersSection = lazy(() => import('../users/Users'))
const BackupSection = lazy(() => import('./Backup'))

type SettingsHubAppContext = {
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
}
const useApp = useAppHook as unknown as () => SettingsHubAppContext

type SettingsHubSection = 'settings' | 'users' | 'backup'

function initialSection(canSettings: boolean, canUsers: boolean, canBackup: boolean): SettingsHubSection {
  if (typeof window !== 'undefined') {
    const segment = String(window.location.pathname || '').toLowerCase()
    if (segment.includes('user') && canUsers) return 'users'
    if (segment.includes('backup') && canBackup) return 'backup'
  }
  if (canSettings) return 'settings'
  if (canUsers) return 'users'
  return 'backup'
}

export default function SettingsHubPage() {
  const { t, getPermissionTier } = useApp()
  // The settings SECTION door matches the old page's own nuances: the
  // narrower per-field grants (business_identity / sales_policy /
  // drive_credentials) open Settings too -- Settings.tsx self-gates which
  // fields render once inside, exactly as before the merge.
  const canSettings = getPermissionTier('settings') !== 'none'
    || getPermissionTier('business_identity') !== 'none'
    || getPermissionTier('sales_policy') !== 'none'
    || getPermissionTier('drive_credentials') !== 'none'
  const canUsers = getPermissionTier('users') !== 'none'
  const canBackup = getPermissionTier('backup') !== 'none'
  const [section, setSection] = useState<SettingsHubSection>(() => initialSection(canSettings, canUsers, canBackup))

  const tabs: Array<{ id: SettingsHubSection; label: string; icon: typeof SettingsIcon; allowed: boolean; tone: string }> = [
    { id: 'settings', label: t('settings') || 'Settings', icon: SettingsIcon, allowed: canSettings, tone: 'text-blue-600' },
    { id: 'users', label: t('users') || 'Users', icon: UsersIcon, allowed: canUsers, tone: 'text-violet-600' },
    { id: 'backup', label: t('backup') || 'Backup', icon: DatabaseBackup, allowed: canBackup, tone: 'text-emerald-600' },
  ]
  const visibleTabs = tabs.filter((tab) => tab.allowed)

  return (
    // Height-filling flex column so the hosted sections' `page-scroll`
    // roots get a bounded height and actually scroll (Y4 regression --
    // a plain block root clipped Settings/Users/Backup at the fold).
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      {visibleTabs.length > 1 ? (
        <div className="shrink-0 px-4 pt-4">
          <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-800 p-0.5">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSection(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${section === tab.id ? `bg-white dark:bg-gray-900 shadow ${tab.tone}` : 'text-gray-500'}`}
                >
                  <Icon className="w-4 h-4" /> {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{t('loading') || 'Loading'}...</p>}>
        {section === 'users' && canUsers ? <UsersSection />
          : section === 'backup' && canBackup ? <BackupSection />
          : canSettings ? <SettingsSection />
          : canUsers ? <UsersSection />
          : <BackupSection />}
      </Suspense>
    </div>
  )
}
