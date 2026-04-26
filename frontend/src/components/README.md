# Components Folder Guide

UI domains are split by feature folders/files.

## Page Ownership

Primary pages are mounted by `frontend/src/App.jsx` through lazy imports:

- `dashboard/Dashboard.jsx`
- `products/Products.jsx`
- `pos/POS.jsx`
- `inventory/Inventory.jsx`
- `sales/Sales.jsx`
- `returns/Returns.jsx`
- `contacts/Contacts.jsx`
- `users/Users.jsx`
- `catalog/CatalogPage.jsx`
- `loyalty-points/LoyaltyPointsPage.jsx`
- `receipt-settings/ReceiptSettings.jsx`
- `utils-settings/Settings.jsx`
- `server/ServerPage.jsx`
- `files/FilesPage.jsx`

## Folder Roles

- `auth/` - login and verification flows
- `dashboard/` - dashboard widgets and charts
- `products/` - product CRUD, import, category/unit/brand management
- `pos/` - checkout/cart UI and quick-add helpers
- `inventory/` - inventory summaries, grouped movements, detail modals
- `sales/` - sales listing/export/details
- `returns/` - customer/supplier return workflows
- `contacts/` - customers, suppliers, delivery contacts
- `users/` - users, roles, profile security UI
- `receipt-settings/` - receipt field configuration, preview, print settings
- `utils-settings/` - backup, audit, reset, typography/settings, OTP helpers
- `shared/` - reusable UI and help/navigation metadata

## Component Rules

1. Call backend logic through `frontend/src/api/methods.js`.
2. Keep shared helpers in feature-level subfiles or `shared/`, not duplicated per page.
3. Maintain responsive layouts; desktop-first behavior must still degrade cleanly on smaller screens.
