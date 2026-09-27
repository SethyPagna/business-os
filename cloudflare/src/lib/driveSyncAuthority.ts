import type { Env } from '../index'
import { getDb } from './db'
import { hasPermission, type PermissionUser } from './permissions'
import { canViewAcquisitionCosts } from './acquisitionCostAccess'
import { DRIVE_SYNC_AUTHORIZED_BY_KEY } from './googleDrive'

// P1-2 (Release 1 auth audit). A Drive sync uploads the WHOLE database
// backup -- acquisition costs included -- to whichever Google account
// connected the integration. Connecting (oauth/start) and enabling it
// (preferences) only needed the `settings` grant, so a settings-only user
// could point the scheduled push at their own Drive and receive every full
// backup from then on, although the manual push (/system/drive-sync/jobs)
// already demanded cost-view.
//
// The rule, in one place: whoever authorises the destination must hold
// `backup` (strict: `settings` does not stand in for it) AND cost-view,
// which is what taking a backup copy home amounts to. The route gates use
// canAuthorizeDriveSync on the session user; the OAuth callback records the
// authoriser's id (lib/googleDrive.ts's completeDriveOauth); and every push
// re-checks that stored authoriser at run time, so a later demotion,
// deactivation or deletion stops the uploads without anyone remembering to
// disconnect Drive.
export function canAuthorizeDriveSync(user: PermissionUser): boolean {
  return !!user && hasPermission(user, 'backup') && canViewAcquisitionCosts(user)
}

export const DRIVE_SYNC_AUTHORIZER_REQUIRED_MESSAGE =
  'Google Drive sync is paused: reconnect Google Drive as a user with Backup and cost-view permission.'

export type DriveSyncAuthorizerCheck =
  | { allowed: true; userId: number }
  | { allowed: false; reason: 'authorizer-missing' | 'authorizer-inactive' | 'authorizer-lacks-grants'; message: string }

type AuthorizerRow = {
  id: number
  username: string | null
  permissions: string | null
  is_active: number | null
  role_code: string | null
  role_permissions: string | null
}

export async function checkDriveSyncAuthorizer(env: Env): Promise<DriveSyncAuthorizerCheck> {
  const db = getDb(env)
  const setting = await db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string | null }>([DRIVE_SYNC_AUTHORIZED_BY_KEY])
  const userId = Number(setting?.value || 0)
  // A connection made before the authoriser was recorded has no owner to
  // re-check, so it fails closed until someone entitled reconnects.
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return { allowed: false, reason: 'authorizer-missing', message: DRIVE_SYNC_AUTHORIZER_REQUIRED_MESSAGE }
  }
  const user = await db.prepare(`
    SELECT u.id, u.username, u.permissions, u.is_active, r.code AS role_code, r.permissions AS role_permissions
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.deleted_at IS NULL
    LIMIT 1
  `).get<AuthorizerRow>([userId])
  if (!user || !user.is_active) {
    return { allowed: false, reason: 'authorizer-inactive', message: DRIVE_SYNC_AUTHORIZER_REQUIRED_MESSAGE }
  }
  if (!canAuthorizeDriveSync(user)) {
    return { allowed: false, reason: 'authorizer-lacks-grants', message: DRIVE_SYNC_AUTHORIZER_REQUIRED_MESSAGE }
  }
  return { allowed: true, userId }
}
