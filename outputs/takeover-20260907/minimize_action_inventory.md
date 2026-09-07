# Editable action minimize inventory

Source commit: `1adf2407169062acd62b0c260a196996c5ebf993`.

The shared Modal must keep minimize capability explicit. A safe flow supplies its own serializer, exact actor/org-scoped draft key, restore payload, host page, current permission requirement, and discard routine. A generic icon cannot derive those facts from `dirty: true`.

Already durable work is the first release slice: standalone add product, edit product, Fast stock-in, Receive batch, and Create products session. Receive batch is implemented in `b0f7af67` plus `ce249c2e`; Create products session and Fast stock-in host parity are assigned to their current file owners. Edit product is the next ProductForm slice because it already has a per-product draft and rejects drafts older than the server record.

The complete confirmed omitted inventory is in `minimize_action_inventory.json`. It covers product/stock actions, ordinary entity forms, transaction editors, account/profile editors, and large imports. Read-only overlays, scanners, details, reports, histories, pickers, exports and confirmations are excluded because there is no editable draft to preserve.

Implementation order:

1. Finish the already-durable flows and current permission checks.
2. Add typed drafts to stock adjust/transfer/batch/reason/session actions. Refetch current stock/version on restore and retain only failed rows after partial bulk commits.
3. Add scoped create/entity drafts to branch, fee, contact, promotion, lookup and variant forms. Edit drafts require a server version floor or explicit conflict handling.
4. Add transactional drafts for returns, sales and shifts, always refetching the record before submit.
5. Store large import text/Blobs in scoped IndexedDB with quota failure handling or retain a server upload/job reference. Do not put them in localStorage.

Password and OTP values remain memory-only. Persisting them into localStorage to make a minus appear would create an unsafe and misleading preservation promise; a separate memory-only shell needs an explicit product decision.
