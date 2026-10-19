-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero invalid_employee_permissions
SELECT COUNT(*) AS employee_roles,
       COALESCE(SUM(CASE WHEN json_valid(permissions)=1 THEN
         CASE WHEN json_type(permissions)='object' THEN 0 ELSE 1 END
         ELSE 1 END),0) AS invalid_employee_permissions
FROM roles
WHERE code='employee';
