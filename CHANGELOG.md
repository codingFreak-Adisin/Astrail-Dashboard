# Changelog

All notable changes to Astrail are documented here.

## [0.3.0.0] - 2026-07-15

### Added

- Connect agents to third-party SaaS through per-user OAuth grants bound to the exact provider endpoints, security scheme, and API origin imported from the contract.
- Review provider identities, granted scopes, connection health, and end-user ownership in the dashboard, with explicit origin confirmation for custom OAuth providers.
- Learn the third-party SaaS OAuth workflow through a dedicated guide and clearer landing, comparison, setup, and API documentation.

### Changed

- Make hosted consent the only production OAuth-token entry path, enforce verified hosts for known providers, and require API re-import plus reconnect for legacy unbound grants.
- Scope idempotent results to the caller, role, current permissions, endpoint/provider fingerprint, and credential identity while safely blocking ambiguous pre-upgrade records.
- Preserve precise OAuth scope and credential-backend failures across direct MCP, bundle, meta-tool, and static Code Mode execution.

### Fixed

- Prevent cross-user replay, cross-provider token injection, absolute-path origin escape, bearer fallback for ambiguous legacy auth, malformed-scope fail-open behavior, and token decryption before peer-refresh scope validation.
- Select a valid grant across multiple OAuth alternatives, filter identities before bounded credential queries, and surface permanent refresh rejection as reauthorization instead of a transient retry.

## [0.2.0.0] - 2026-07-14

### Added

- Connect customers through hosted OAuth consent with PKCE, encrypted per-user credentials, provider presets, automatic refresh, and re-authentication recovery.
- Configure customer-specific request and response field mappings, bounded retry policies, idempotency, action-level permissions, and scoped consumer API keys from the dashboard.
- Create signed replay-safe webhook endpoints, monitor OpenAPI schema drift, migrate generated tools without losing policies, export audit history, and track integration setup and support costs.

### Changed

- Bind end-user identity and actor roles to API keys so callers cannot self-assign another customer or privilege level.
- Make OAuth refresh, callback state claiming, write idempotency, schema migration, health probes, audit pagination, cost aggregation, and circuit recovery safe under concurrent production traffic.
- Expand the integration operations UI and documentation with concrete setup guidance for OAuth, mappings, retries, webhooks, schema changes, audit exports, and cost measurement.

### Fixed

- Prevent prototype-property field mappings, webhook replay/header abuse, cross-tenant RLS references, double-applied argument mappings, oversized provider responses, and credential fallback across incompatible authentication schemes.
- Isolate failed JSON-RPC batch items, preserve legacy credential compatibility, rotate schema-watch work fairly, and return consistent validation errors from new APIs.
