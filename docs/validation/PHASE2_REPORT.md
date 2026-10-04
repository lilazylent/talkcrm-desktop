# Phase 2 validation — 2026-10-03

Status: implementation and local verification complete; real-account acceptance pending user connection. Phase 2 is not declared complete. Phase 3 has not started.

## Implementation

Version 0.2.0; existing Electron project retained. OAuth wizard, Windows DPAPI credential bundles, atomic token rotation with a shared promise lock, validated read-only HTTP client, account current_user_id scope and filter fallback, contact/company identities and links, pipelines/statuses, tasks, deal notes, custom fields, transactional cache and separate demo mode.

## Executed checks

| Check | Result |
| --- | --- |
| TypeScript renderer + Electron | Passed |
| ESLint | Passed, 0 errors |
| Vitest | 59 passed, 0 failed, 4 files |
| Production Vite build | Passed |
| Electron main/preload bundle | Passed |
| Windows NSIS installer | Passed |
| Production dependency audit | 0 vulnerabilities |
| Actual Windows safeStorage/DPAPI smoke | Passed |
| Phase 1 normal AppData migration | Passed |
| Installed 0.2.0 UI/cache | Passed with synthetic CRM data |
| Real amoCRM account | Pending |

Tests: 33 API/OAuth/pagination/mapping/collector scenarios, 13 migration/cache/credential/service scenarios, 5 existing repository scenarios, 8 React screen scenarios. HTTP cases include concurrent expiry/401 rotation, failed credential persistence, 429/5xx retry, errors 401/402/403/404/422, unsafe domains/endpoints, repeated/foreign next links, primary contact links, responsible-filter fallback and optional failure. Repository tests include idempotency, partial category retention, core rollback, offline reopen, read-only tasks, missing records and disconnect/purge.

## Database and upgrade

Normal existing database: `C:\Users\lilaz\AppData\Roaming\TalkCRM Desktop\talkcrm.sqlite`.

Installed Phase 1 (0.1.0) was observed before upgrading. Captured its on-disk baseline without modification, installed 0.2.0 over the existing installation, launched, then compared profile rows, all existing setting values and entity counts. Migration 002 is present, baseline is preserved. Evidence: upgrade-before.json, upgrade-after.json. Backups: release/phase1/existing-phase1.sqlite and release/phase1/TalkCRM Setup 0.1.0.exe. AppData was not deleted.

Migration 002 adds CRM accounts, entity payloads with account/type/external ID identity and local IDs, external_updated_at/last_seen_at/availability, relations, custom definitions, sync history and source columns. Existing Phase 1 tables and seed remain.

## Desktop validation

Browser: inspected two-step wizard and masked inputs; screenshot wizard-browser.png. Electron: inspected CRM dashboard, clients, company workspace, linked company/contact, notes/custom fields and read-only task. Packaged/installed executable: verified version 0.2.0, normal AppData path/settings, isolated CRM cache rendered without authorization/network, and disabled task completion control through accessibility tree.

An initial startup/second-instance defect was found during installer verification and repaired before the final build. The installed final package contains the instance guard and window display/focus handling. The normal installed profile is left open on Settings for user connection; isolated QA profile is separate and contains only synthetic data.

This verifies offline startup from an unauthorized cached account, not a successful live amoCRM synchronization. No real account has yet been connected during this validation.

## Security evidence

- OAuth service tests confirm access/refresh/client secret/code sentinels absent from SQLite and snapshots.
- Transport tests confirm tokens and raw server/network errors are absent from safe logs.
- Actual Electron safeStorage smoke on Windows: encryption available, round-trip true, plaintextOnDisk false, deletion true (windows-credentials.json).
- Complete encrypted token pair is persisted before refresh waiters resume. Failed/uncertain rotation blocks old-token reuse.
- Codes are cleared after exchange; React input fields are cleared on submission. JavaScript strings cannot be reliably zeroized.
- Renderer receives connection metadata and CRM cache, never saved tokens/secret bundles. Real credentials originate only in the user-entered wizard fields.
- Source/packaging contains no permanent integration secret. This project has no Git repository or commits; no real credentials were committed or pushed.
- CRM requests are GET only; OAuth POST is the sole permitted write-shaped request. CRM task completion is blocked in both UI and repository.

Real-account credential/log checks will be recorded only after the user connects; current evidence uses test sentinels and the actual Windows encryption mechanism.

## Installer

Path: `C:\Samosale soft\TalkCRM Desktop\release\TalkCRM Setup.exe`

Size: 121492683 bytes. SHA-256: D57461D05580C106FCFFABDAE7CCECFD3A2C4A465E3F3B28020A3D16EB925B57.

Windows x64 NSIS; unsigned (Get-AuthenticodeSignature: NotSigned). Installed under the current user's Local Programs/TalkCRM Desktop. Existing database upgrade was verified.

## Remaining limitations and acceptance

- Real OAuth connection, live current-user scope, exact account data and live token refresh remain unverified until user setup in the app.
- Refresh uses a complete scope scan, no background poll or incremental cursor. Large scopes take time.
- A permission failure in an optional category retains older data and reports partial_error.
- Missing records remain visible as unavailable; no automatic hard deletion.
- Responsible displayed by verified user ID; no admin user-directory dependency.
- Standard v4 account info may not return currency; numeric amounts are shown without an invented currency symbol.
- Client card shows the newest 20 notes; complete fetched notes remain cached.
- Installer is unsigned. Kontur.Talk, real meetings, AI and CRM write-back are future phases.

The domain/service/cache boundaries are ready for Kontur.Talk work, but Phase 3 must wait for mandatory Phase 2 real-account acceptance.
