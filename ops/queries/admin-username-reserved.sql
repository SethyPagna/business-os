-- Security hunt H-sec #1: permissions.ts treats the literal username 'admin'
-- as an administrator. This shows whether a row still holds that name (which
-- blocks a self-rename to it). Selects no password, hash, OTP secret or contact.
-- ops:min-rows 0
SELECT u.id, u.is_active, r.code AS role_code
FROM users u LEFT JOIN roles r ON r.id = u.role_id
WHERE lower(trim(u.username)) = 'admin'
