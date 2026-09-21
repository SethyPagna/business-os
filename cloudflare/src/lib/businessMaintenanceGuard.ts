// Append this as the final statement of an ordinary business D1 batch. D1
// rolls back the entire batch if maintenance arrived after route admission.
// Maintenance-owned restore/reset operations must not use this assertion.
export const ordinaryBusinessMaintenanceGuard = {
  sql: `SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM system_flags WHERE key = 'maintenance'
  ) THEN 1 ELSE json_extract('[1]', '$[ordinary_business_maintenance_active]') END AS ordinary_business_maintenance_guard`,
  params: {},
} as const
