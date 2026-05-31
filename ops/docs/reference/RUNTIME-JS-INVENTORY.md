# Runtime JavaScript Inventory

Generated: 2026-05-31T00:37:47.469Z

## Summary

- Runtime JavaScript files: 11
- Allowed generated/vendor files: 11
- Unclassified files: 0
- Missing TypeScript sources for generated files: 0
- Mode: fail if any unclassified first-party JavaScript, JSX, MJS, or CJS file is found outside dependency/generated bulk folders.

## Category Totals

| Category | Files |
| --- | --- |
| tracked vendor scanner bundle | 6 |
| generated browser runtime asset | 2 |
| generated backend runtime entry | 1 |
| generated PM2 runtime config | 1 |
| generated service worker asset | 1 |

## Files

| Path | Category | Source / Owner | Allowed | Proof |
| --- | --- | --- | --- | --- |
| backend/server.js | generated backend runtime entry | backend/server.ts | yes | npm.cmd --prefix backend run verify:server-entry |
| frontend/public/runtime-noise-guard.js | generated browser runtime asset | frontend/src/public-runtime/runtime-noise-guard.ts | yes | npm.cmd --prefix frontend run verify:public-runtime |
| frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.js | tracked vendor scanner bundle | frontend/public/scanbot-web-sdk | yes | Scanner replacement must be proven before deleting or converting vendor files. |
| frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Asm-simd-threads.worker.js | tracked vendor scanner bundle | frontend/public/scanbot-web-sdk | yes | Scanner replacement must be proven before deleting or converting vendor files. |
| frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd-threads.js | tracked vendor scanner bundle | frontend/public/scanbot-web-sdk | yes | Scanner replacement must be proven before deleting or converting vendor files. |
| frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core-simd.js | tracked vendor scanner bundle | frontend/public/scanbot-web-sdk | yes | Scanner replacement must be proven before deleting or converting vendor files. |
| frontend/public/scanbot-web-sdk/bundle/bin/barcode-scanner/ScanbotSDK.Core.js | tracked vendor scanner bundle | frontend/public/scanbot-web-sdk | yes | Scanner replacement must be proven before deleting or converting vendor files. |
| frontend/public/scanbot-web-sdk/bundle/ScanbotSDK.ui2.min.js | tracked vendor scanner bundle | frontend/public/scanbot-web-sdk | yes | Scanner replacement must be proven before deleting or converting vendor files. |
| frontend/public/sw.js | generated service worker asset | frontend/src/public-runtime/service-worker.ts | yes | npm.cmd --prefix frontend run verify:public-runtime |
| frontend/public/theme-bootstrap.js | generated browser runtime asset | frontend/src/public-runtime/theme-bootstrap.ts | yes | npm.cmd --prefix frontend run verify:public-runtime |
| ops/config/ecosystem.config.js | generated PM2 runtime config | ops/config/ecosystem.config.ts | yes | npm.cmd --prefix ops run verify:ecosystem-config |
