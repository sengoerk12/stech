# Verification notes

## Verified
- API and mobile TypeScript checks.
- API TypeScript compilation.
- Mobile ESLint check.
- Expo export for web, iOS and Android (JavaScript/Hermes bundles; not signed native binaries).
- 35 unit/integration cases passed: HTTP, auth, idempotency, money, webhook handling, durable database restart, rollback, outbox recovery, concurrent workers, token replay, registration, minimum/bonus thresholds, PanCafe credentials, isolated/native destinations, history normalization, timezone handling, native pagination and member/session isolation. Type checks, mobile lint and API build passed.
- Live PanCafe cashier/mobile history read and normalized successfully. Native history/session reader tested on an isolated copy, including 120-row pagination, source receipt join and completed PC-session fields. The live installation has no completed PC sessions yet; actual PanCafe UI session creation remains unverified because the running window is not exposed to Computer Use.
- PanCafe native writers passed on isolated database copies: member creation, UTF8, zero balance, native balance/bonus credit, history, idempotency and atomic rollback. These tests did not create live members or credit live balances. The elevated live bridge reports connected and balance-credit enabled; live client spending semantics and a user-initiated live topup remain to be verified. See `PANCAFE_SETUP.md`.
- Registration: zero balance, empty history, optional contact fields, unique normalized usernames, salted password hashes, persistence across restart, no cross-account balance leakage and rejection of client-supplied balances. Web signup and profile verified with a local test account.
- Follow-up verification (2026-10-19): the registration changes export successfully for iOS, Android and web. After restarting the API, the previously created test account still has a zero balance, no transactions, no pending payments and empty optional contact fields.
- Web UI: onboarding, login, dashboard, top-up quote and simulated successful payment; 742.50 + 500 + 50 = 1292.50 TRY.
- Responsive web preview at 390 and 320 CSS pixels. This is not a substitute for native device testing.

## Known release blockers
- PanCafe local member/read/credit adapter enabled with a mock checkout. Real payment provider, vendor-supported production integration, actual client login/spending and a user-initiated live topup still require verification. Production/staging startup remains blocked.
- SQL layer tested on PGlite. The node-postgres path is implemented but a standalone PostgreSQL server and multi-process load tests were not available here.
- Push delivery, password reset integration and approved legal documents pending.
- Store signing, native device testing and store submissions not performed.
- Initial `npm audit` reports 27 affected packages (19 high, 8 moderate), propagated from three transitive dependencies in Expo/RN tooling: braces, node-forge and uuid. Latest registry versions of braces (3.0.3) and node-forge (1.4.0) remain in the reported vulnerable ranges. The automatic suggested Expo downgrade to SDK 44 is incompatible and was not applied. Assess reachability and apply upstream patches before release. The development bundler must not be exposed publicly.

## Machine-specific disk workaround
The C: drive ran out of space during initial installation. Dependencies/build mirror are on `D:\stech-build-cache\project`. The source of record stays at `C:\Users\MONSTER\Desktop\stech`. Only npm cache files created during this task were relocated to `D:\stech-build-cache\initial-install-cache`; no unrelated user documents were removed. A local `node_modules` junction points to the installed dependency directory. On another machine, a normal `npm install` is sufficient.

The first incomplete `node_modules` folder is preserved as `node_modules.incomplete`; automated approval rejected deleting it. It is ignored by Git.

Expo's asset export cannot serialize the cross-drive node_modules junction into asset paths. Use `scripts/sync-local-preview.ps1`, then run the bundler/export from the D: preview directory. The C: source TypeScript, lint and API tests work with the dependency junction.
