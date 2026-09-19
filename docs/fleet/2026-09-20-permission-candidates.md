# Permission rules observed during the cost-access change

These are audit candidates, not proposed removals. Existing safeguards remain in place.

| Rule | Evidence | Follow-up question |
| --- | --- | --- |
| Products import replacement requires `destructive_delete` in addition to ordinary import access. | `frontend/src/components/products/import/BulkImportModal.tsx`, `canReplaceAll`; Worker `routes/importJobs.ts`. | Does the owner want separate replace-columns and replace-all grants? Both currently retain the destructive-operation guard. |
| Dated stock reconciliation requires the full inventory `stock_count` action. | `BulkImportModal.tsx`, `canDatedStockCount`; Worker inventory reconciliation routes. | Should a separate stock-count role be offered? Do not weaken the route gate merely to reveal this entry point. |
| Image-only import uses the products import-job type. | `BulkImportModal.tsx`, `handleImageOnlyImport`, policy `mode: images_only`; Worker `isAcquisitionCostImport('products')`. | The current backend therefore also requires cost-edit access for image-only jobs. A policy-specific exemption would need backend and UI parity review. |
| Products image-only access is exclusive with ordinary Products access. | `frontend/src/components/users/permissionDefinitions.ts`, `exclusiveWithTier`; `Products.tsx`, `isImageOnlyUser`. | Decide whether this is still the intended role model before changing its exclusivity. |
| Conflict product removal has a separate `canRemoveProduct` gate. | `frontend/src/components/products/ProductDuplicatesTab.tsx`, cluster removal controls. | Preserve removal authority separately from cost viewing and editing. |
| Merge confirmation is based on stock, identity, price changes and cost changes. | `frontend/src/components/products/mergeConfirmationRule.ts`, `mergeNeedsConfirmation`. | Redacting cost display must not silently authorize a merge that previously needed confirmation. The confirmation rule was left unchanged. |
| Financial import review and error files require cost view, while financial import writes require cost edit. | Worker `routes/importJobs.ts`, `requireImportPermission`. | Edit-only users can submit but cannot inspect server review data; ensure operational assignments include a permitted reviewer when needed. |

Financial import types inspected: products, inventory, sales and stock_actions. Customer, supplier and delivery-contact import types retain their existing section permissions; no new cost rule was inferred for them in the frontend.

No deployment, migration, remote data change, or permission-preset grant was performed by this review.
