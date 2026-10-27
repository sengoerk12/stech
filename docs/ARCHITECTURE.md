# S TECH architecture

## Boundaries
- `apps/mobile`: React Native / Expo Router, TypeScript, TanStack Query, native SecureStore. Web preview keeps tokens in memory only.
- `apps/api`: NestJS `/api/v1`, explicit DTO validation, bearer authorization, signed payment events and rate limiting.
- `packages/contracts`: typed DTOs; money is integer kurus.
- `CafeSystemAdapter`: existing cafe boundary. `RealCafeSystemAdapter` deliberately throws until the API contract is supplied.
- `PaymentProvider`: idempotent checkout creation and raw webhook verification. Only the mock provider is enabled.

## Persistence
Development uses PostgreSQL SQL through a `Database` interface. Default storage is PGlite (embedded Postgres), persisted in `DATA_DIR`. Set `DATABASE_URL` to use node-postgres with a standalone PostgreSQL server. PGlite is single-process development storage: never open the same directory in multiple API processes.

Runtime schema: `apps/api/src/database/schema.ts`. Generated SQL: `database/001_runtime.sql`. Startup initializes v1 additively/idempotently; standalone PG uses an advisory transaction lock. Future schema changes must use explicit versioned migrations rather than changing existing v1 definitions.

Payment orders, provider events, transfer jobs, transfer ledger, token hashes/families, preferences and audit logs are durable. Restarting the API preserves them. The demo cafe wallet is persisted separately in `demo_*` tables and seeded only once.

## Source of truth
The real cafe owns membership, spendable balance, usage and tariffs. The mobile backend owns payment orchestration, event deduplication, transfer audit and preferences. `demo_*` tables emulate that external cafe for development; they are not a second production wallet. The backend transfer ledger is never independently spendable.

## Implemented payment flow
1. Quote server-side from persisted promotion definitions; snapshot the bonus on the order.
2. Atomically insert with unique `(user_id,idempotency_key)`. A different amount conflicts. Create provider checkout with the stable payment ID, requiring provider idempotency on retries.
3. Verify webhook signature/replay window and match order, amount and currency. Deduplicate `(provider,event_id)` and compare event fingerprints.
4. In one SQL transaction, lock the order, persist the event, transition to transferring and create the transfer job. No network call runs inside that transaction.
5. A worker claims a job with a lease token and expiry, then invokes `addBalance` with the payment ID as immutable operation key.
6. The demo cafe atomically deduplicates the operation, adds paid and bonus ledger entries and updates its own wallet in a SQL transaction.
7. In a separate local transaction, confirm the current lease, write transfer audit entries and mark completed. The phone only then shows success.
8. Timeouts retain transferring and retry with exponential backoff. Expired worker leases recover after restart. After ten failures the job moves to reconciliation, while the paid order remains transferring.

A local SQL transaction cannot atomically commit an external API operation. The real cafe MUST support idempotent operation IDs or reliable transaction lookup/reconciliation. Never enable blind retries without this guarantee. Refund and reconciliation admin workflows remain pending.

## Auth
Opaque 15-minute access tokens, rotating 30-day refresh tokens; only hashes are persisted. Token-family row locks serialize refresh/revocation. Replay commits family revocation before returning 401. Logout revokes the family. Native tokens use SecureStore only when remember-me is enabled. Real authentication will delegate to the cafe; the demo credential is a fixture.

## UI recovery
Dashboard exposes the user's pending/transferring orders to reopen interrupted payments. Transferring orders trigger polling. A completed result invalidates the wallet cache. Checkout supports successful, rejected and deliberately delayed simulations; none charges a card.

## Release gates
- Real cafe API, authentication/reset, bonus/refund semantics and idempotency.
- Hosted/SDK payment integration, merchant checks and provider-specific webhook test vectors.
- Standalone PostgreSQL multi-process/load tests, backup/restore and monitoring. Current SQL tests run on PGlite's Postgres engine.
- Distributed rate limits and operational reconciliation tools.
- Push device registration/delivery and credentials; only preferences are implemented.
- Native device tests, accessibility audit, signing/store assets and approved legal content.
- Dependency vulnerability review in `VERIFICATION.md`.

Production/staging startup and production mobile builds stay blocked. QR, active PC sessions and loyalty privileges remain disabled; no live PC data is fabricated.

## References
- https://docs.expo.dev/versions/v58.0.0/
- https://docs.expo.dev/versions/v58.0.0/sdk/securestore/
- https://docs.nestjs.com/faq/raw-body
- https://pglite.dev/docs/api
- https://node-postgres.com/features/transactions
