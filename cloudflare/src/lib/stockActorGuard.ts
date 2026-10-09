import type { SessionUser } from './auth'

export const stockActorPredicate = `EXISTS(SELECT 1 FROM users actor LEFT JOIN roles role ON role.id=actor.role_id
    WHERE actor.id=@stockActorId AND actor.is_active=1 AND actor.username IS @stockActorUsername
    AND actor.organization_id IS @stockActorOrganization AND actor.role_id IS @stockActorRole AND actor.permissions IS @stockActorPermissions
    AND role.code IS @stockActorRoleCode AND role.permissions IS @stockActorRolePermissions
    AND COALESCE(actor.must_change_password,0)=@stockActorMustChange)`

export function stockActorParams(user: SessionUser): Record<string, unknown> {
    return { stockActorId: user.id, stockActorUsername: user.username, stockActorOrganization: user.organization_id ?? null,
        stockActorRole: user.role_id ?? null, stockActorPermissions: user.permissions ?? null, stockActorRoleCode: user.role_code ?? null,
        stockActorRolePermissions: user.role_permissions ?? null, stockActorMustChange: user.must_change_password ?? 0 }
}
