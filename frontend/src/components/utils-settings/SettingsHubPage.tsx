import { getHubDestinations, useHubSection } from '../shared/hubNavigation.ts'
import { Suspense, lazy } from 'react'
import SettingsIcon from 'lucide-react/dist/esm/icons/settings.js'
import UsersIcon from 'lucide-react/dist/esm/icons/users.js'
import DatabaseBackup from 'lucide-react/dist/esm/icons/database-backup.js'
import { useApp as useAppHook } from '../../AppContext.tsx'
import HubSectionNav, { type HubSectionDef, readStoredHubSection } from '../shared/HubSectionNav.tsx'

// E4 (Part 403): Settings absorbs Users and Backup as sections of one
// page. Pure rewiring per the Phase-E contract: the three section
// components move intact with their own permission keys ('settings' /
// 'users' / 'backup'); only the standalone users/backup PAGE ids retire,
// and their old URLs land here with the right section open.

const SettingsSection = lazy(() => import('./Settings'))
const UsersSection = lazy(() => import('../users/Users'))
const BackupSection = lazy(() => import('./Backup'))

type SettingsHubAppContext = {
  navigateTo: (pageId: string, anchor?: string) => void
  t: (key: string, fallback?: string) => string
  getPermissionTier: (key: string) => string
  hasPermission: (key: string) => boolean
}
const useApp = useAppHook as unknown as () => SettingsHubAppContext

type SettingsHubSection = 'settings' | 'users' | 'backup'

const SETTINGS_HUB_STORAGE_KEY = 'bos:hub:settings:active'

function initialSection(canSettings: boolean, canUsers: boolean, canBackup: boolean): SettingsHubSection {
  if (typeof window !== 'undefined') {
    const segment = String(window.location.pathname || '').toLowerCase()
    if (segment.includes('user') && canUsers) return 'users'
    if (segment.includes('backup') && canBackup) return 'backup'
  }
  const validIds = (['settings', 'users', 'backup'] as SettingsHubSection[]).filter((id) =>
    (id === 'settings' && canSettings) || (id === 'users' && canUsers) || (id === 'backup' && canBackup))
  const stored = readStoredHubSection(SETTINGS_HUB_STORAGE_KEY, validIds) as SettingsHubSection | null
  if (stored) return stored
  if (canSettings) return 'settings'
  if (canUsers) return 'users'
  return 'backup'
}

export default function SettingsHubPage() {
  const { t, getPermissionTier, hasPermission, navigateTo } = useApp()
  // The settings SECTION door matches the old page's own nuances: the
  // narrower per-field grants (business_identity / sales_policy /
  // drive_credentials) open Settings too -- Settings.tsx self-gates which
  // fields render once inside, exactly as before the merge.
  const canSettings = getPermissionTier('settings') !== 'none'
    || getPermissionTier('business_identity') !== 'none'
    || getPermissionTier('sales_policy') !== 'none'
    || getPermissionTier('drive_credentials') !== 'none'
  // Users management is admin-only (Part 557 slice 3): the whole
  // routes/users.ts surface gates on isAdminControlUser and Users.tsx's
  // canManage is hasPermission('all'), so the section door must match --
  // gating on the (backend-unchecked) `users` key would show a stale grant
  // holder an empty, no-op section. hasPermission('all') === isAdminControlUser.
  const canUsers = hasPermission('all')
  const canBackup = getPermissionTier('backup') !== 'none'
  const [section, setSection] = useHubSection<SettingsHubSection>('settings', () => initialSection(canSettings, canUsers, canBackup), getHubDestinations('settings', { getPermissionTier, hasPermission }).map((item) => item.id), navigateTo)

  const tabs: HubSectionDef[] = [
    { id: 'settings', label: t('settings') || 'Settings', icon: SettingsIcon, hidden: !canSettings, tone: 'text-blue-600', description: t('hub_desc_settings_settings') || 'Business and app preferences' },
    { id: 'users', label: t('users') || 'Users', icon: UsersIcon, hidden: !canUsers, tone: 'text-violet-600', description: t('hub_desc_settings_users') || 'Manage staff accounts' },
    { id: 'backup', label: t('backup') || 'Backup', icon: DatabaseBackup, hidden: !canBackup, tone: 'text-emerald-600', description: t('hub_desc_settings_backup') || 'Backup and restore data' },
  ]

  return (
    // Height-filling flex column so the hosted sections' `page-scroll`
    // roots get a bounded height and actually scroll (Y4 regression --
    // a plain block root clipped Settings/Users/Backup at the fold).
    <div className="flex min-h-0 flex-1 flex-col space-y-3">
      <HubSectionNav
        sections={tabs}
        active={section}
        onChange={(id) => setSection(id as SettingsHubSection)}
        storageKey={SETTINGS_HUB_STORAGE_KEY}
        pageId="settings"
      >
      <Suspense fallback={<p className="p-4 text-sm text-gray-500">{t('loading') || 'Loading'}...</p>}>
        {section === 'users' && canUsers ? <UsersSection />
          : section === 'backup' && canBackup ? <BackupSection />
          : canSettings ? <SettingsSection />
          : canUsers ? <UsersSection />
          : <BackupSection />}
      </Suspense>
      </HubSectionNav>
    </div>
  )
}
