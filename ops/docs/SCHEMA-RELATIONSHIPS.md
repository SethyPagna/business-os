# Schema Relationships

Business OS schema lives in Postgres. Core relationships:

- Products connect to product images, branch stock, inventory movements, sale items, return items, and import history.
- Branch stock connects products to branches and drives inventory summaries.
- Users connect to roles, permissions, audit logs, action history, and sessions.
- File assets reference MinIO object keys and public upload paths.
- Backup metadata records Docker package manifests, Drive versions, and restore validation.
