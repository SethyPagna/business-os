# Performance Scan

Auto-generated performance scan for source size/complexity and built frontend chunks.

## 1. Scope

- Frontend source: `frontend/src`
- Backend source: `backend/src`
- Project scripts: `ops/scripts`
- Project root run/config files
- Built chunks: `frontend/dist/assets` (if present)

## 2. Largest Source Files (by size)

| File | Size (KB) | Lines |
|---|---:|---:|
| `frontend/src/components/catalog/CatalogPage.jsx` | 233.3 | 4258 |
| `frontend/src/lang/km.json` | 129.6 | 1592 |
| `frontend/src/components/pos/POS.jsx` | 83.3 | 1394 |
| `frontend/src/lang/en.json` | 71.4 | 1592 |
| `frontend/src/components/inventory/Inventory.jsx` | 66.8 | 1170 |
| `frontend/src/components/products/Products.jsx` | 54.9 | 961 |
| `frontend/src/components/utils-settings/Settings.jsx` | 53.4 | 1205 |
| `backend/src/routes/sales.js` | 51.1 | 1245 |
| `frontend/src/components/utils-settings/Backup.jsx` | 50.6 | 1146 |
| `frontend/src/components/dashboard/Dashboard.jsx` | 49.8 | 803 |
| `backend/src/routes/system.js` | 47.3 | 1223 |
| `frontend/src/api/methods.js` | 43.3 | 800 |
| `backend/src/routes/users.js` | 41.2 | 1015 |
| `backend/src/database.js` | 39.9 | 1090 |
| `frontend/src/components/files/FilesPage.jsx` | 37.9 | 709 |
| `frontend/src/AppContext.jsx` | 35.6 | 877 |
| `frontend/src/components/auth/Login.jsx` | 34.6 | 816 |
| `backend/src/routes/products.js` | 34.3 | 767 |
| `backend/src/routes/auth.js` | 31.1 | 890 |
| `frontend/src/components/loyalty-points/LoyaltyPointsPage.jsx` | 31.0 | 537 |
| `backend/src/routes/portal.js` | 30.7 | 802 |
| `backend/src/services/googleDriveSync.js` | 30.3 | 873 |
| `frontend/src/components/users/Users.jsx` | 29.3 | 617 |
| `frontend/src/components/users/UserProfileModal.jsx` | 29.1 | 579 |
| `frontend/src/components/shared/pageHelpContent.js` | 28.2 | 447 |

## 3. Largest Source Files (by lines)

| File | Lines | Size (KB) |
|---|---:|---:|
| `frontend/src/components/catalog/CatalogPage.jsx` | 4258 | 233.3 |
| `frontend/src/lang/en.json` | 1592 | 71.4 |
| `frontend/src/lang/km.json` | 1592 | 129.6 |
| `frontend/src/components/pos/POS.jsx` | 1394 | 83.3 |
| `backend/src/routes/sales.js` | 1245 | 51.1 |
| `backend/src/routes/system.js` | 1223 | 47.3 |
| `frontend/src/components/utils-settings/Settings.jsx` | 1205 | 53.4 |
| `frontend/src/components/inventory/Inventory.jsx` | 1170 | 66.8 |
| `frontend/src/components/utils-settings/Backup.jsx` | 1146 | 50.6 |
| `backend/src/database.js` | 1090 | 39.9 |
| `backend/src/routes/users.js` | 1015 | 41.2 |
| `frontend/src/components/products/Products.jsx` | 961 | 54.9 |
| `backend/src/routes/auth.js` | 890 | 31.1 |
| `frontend/src/AppContext.jsx` | 877 | 35.6 |
| `backend/src/services/googleDriveSync.js` | 873 | 30.3 |
| `frontend/src/components/auth/Login.jsx` | 816 | 34.6 |
| `frontend/src/components/dashboard/Dashboard.jsx` | 803 | 49.8 |
| `backend/src/routes/portal.js` | 802 | 30.7 |
| `frontend/src/api/methods.js` | 800 | 43.3 |
| `backend/src/routes/products.js` | 767 | 34.3 |
| `frontend/src/components/files/FilesPage.jsx` | 709 | 37.9 |
| `backend/src/routes/returns.js` | 670 | 25.6 |
| `ops/scripts/generate-full-project-docs.js` | 637 | 22.5 |
| `frontend/src/components/users/Users.jsx` | 617 | 29.3 |
| `backend/src/routes/contacts.js` | 585 | 19.9 |

## 4. Largest Built Chunks

| Asset | Size (KB) |
|---|---:|
| `frontend/dist/assets/index-B2Yy1Hdf.js` | 574.9 |
| `frontend/dist/assets/CatalogPage.js` | 159.5 |
| `frontend/dist/assets/vendor.js` | 130.8 |
| `frontend/dist/assets/index.css` | 93.6 |
| `frontend/dist/assets/Products.js` | 89.1 |
| `frontend/dist/assets/dexie.js` | 72.5 |
| `frontend/dist/assets/POS.js` | 55.6 |
| `frontend/dist/assets/Returns.js` | 53.4 |
| `frontend/dist/assets/lucide.js` | 51.0 |
| `frontend/dist/assets/Inventory.js` | 48.1 |
| `frontend/dist/assets/Dashboard.js` | 43.6 |
| `frontend/dist/assets/Sales.js` | 28.5 |
| `frontend/dist/assets/Branches.js` | 24.1 |
| `frontend/dist/assets/LoyaltyPointsPage.js` | 23.8 |
| `frontend/dist/assets/CustomersTab.js` | 23.0 |
| `frontend/dist/assets/Contacts.js` | 21.6 |
| `frontend/dist/assets/Receipt.js` | 14.0 |
| `frontend/dist/assets/primitives.js` | 3.3 |
| `frontend/dist/assets/ImageGalleryLightbox.js` | 3.2 |

## 5. Notes

- Large source files are candidates for modular split by domain responsibility.
- Large JS chunks are candidates for lazy-loading or manual chunk strategy refinement.
- Maintain functional parity first; apply incremental performance changes with build validation.
