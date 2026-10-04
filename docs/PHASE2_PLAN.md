# Phase 2 implementation contract

## Scope

Latest correction: employee has no integration-management access. Version 0.2.1 adds manual official-site browser authentication and a conditional session API probe; see EMPLOYEE_CONNECTION_PLAN.md. Full real-account acceptance is still pending. Kontur desktop inspection is evidence for the next adapter, not a completed integration.

Extend the existing Electron application with inbound amoCRM synchronization. Only GET CRM requests and POST `/oauth2/access_token` are permitted. No CRM entity mutation API is implemented. Preserve the Phase 1 SQLite database, profile, settings and demo mode.

## Implementation sequence

1. Add migration 002, provenance and account scoped CRM metadata/relations. Back up the existing Phase 1 database and installer before migration testing.
2. Implement a validated HTTPS endpoint, OAuth exchange/rotation with single-flight refresh and atomically encrypted credential bundles.
3. Implement one read-only HTTP client with throttling, bounded retries, validated pagination and safe logs.
4. Map API DTOs into domain entities. Synchronize full current-user scope with capability fallback; commit core data transactionally, retain old cache when optional categories fail.
5. Extend typed IPC and existing Russian UI with connection wizard, progress, refresh, disconnect/cache choices and read-only CRM tasks.
6. Verify migrations, OAuth races, retries, mapping, repeated/partial/offline synchronization and UI. Build version 0.2.0, upgrade the installed Phase 1 application, inspect actual Electron screens and local cache.

## Acceptance scenarios

Implementation status (2026-10-03): migration 002, OAuth/secure store, read-only client, synchronization, IPC and UI implemented. Typecheck, lint, 59 tests, production/Electron/NSIS builds, actual Windows DPAPI, normal AppData upgrade and installed UI/cache checks passed. Evidence: validation/PHASE2_REPORT.md. Real-account acceptance awaits user-entered connection; do not start Phase 3 yet.

- Existing Phase 1 database opens at migration 002 without losing settings or local task changes.
- Invalid domains and HTTP/arbitrary endpoints are rejected before any network request.
- Concurrent expiry/401 responses cause one refresh; the rotated pair is persisted before waiting requests resume.
- Broken pagination fails with a controlled error, rather than looping or truncating a successful sync silently.
- Sync includes only current-user leads, preserves contact/company identities and arbitrary custom fields, and never invents missing contacts.
- Identical second sync creates no duplicates. A core failure changes no cached category; optional failure commits good categories and reports partial success.
- CRM tasks cannot be edited in either UI or IPC/repository.
- Restart loads cache without a network request; disconnect can keep cache or explicitly purge account data.
- Tokens, secrets and authorization codes are absent from SQLite, snapshots and logs.
- Real account validation is reported only after user-entered authorization in the application.
