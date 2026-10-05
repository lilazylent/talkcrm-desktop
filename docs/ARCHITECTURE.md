# Architecture

## Phase 2 extension

React → typed DesktopApi → isolated preload → validated Electron IPC → CrmService → OAuthSession + AmoClient + Transport → amoCRM. Cache writes pass through SqliteRepository; secrets pass through EncryptedFileStore → Electron safeStorage → Windows DPAPI.

The sending main window/frame is validated. Production CSP blocks renderer network access. No Node in renderer; sandbox and context isolation remain enabled. Endpoint allowlist permits GET CRM reads and POST only to /oauth2/access_token; redirects and arbitrary origins are rejected. Requests start at 200 ms spacing, timeout after 20 seconds; GET 429/5xx gets at most 3 attempts with Retry-After capped at 60 seconds. Logs never contain request/response bodies, headers or query strings.

The encrypted account bundle contains integration config and the full token pair. SHA-256 namespace filenames prevent path traversal. Encrypted temporary file + rename publishes the bundle atomically. One OAuthSession promise lock serves concurrent expiry/401 requests. A late 401 checks whether its token already rotated. An uncertain OAuth POST or persistence failure blocks reuse and requires reconnection; rotating POST is not automatically retried. Stored bundle expiry is authoritative; SQLite expiry is informational. Authorization code fields are cleared after exchange/submission. JavaScript strings cannot be reliably zeroized; codes are never persisted or logged.

Migration 002 adds account metadata, source columns, CRM entities, relations, custom definitions and sync runs. Unique identity is `(account_id, kind, external_id)`; local IDs include account and entity kind. Contact and company with the same numeric ID stay distinct. Custom values remain in entity JSON. External updated_at, last_seen_at and availability are persisted.

GET /account.current_user_id determines scope; the admin user directory is not requested. Lead responsible filter falls back after 400/422 to complete accessible pagination and local verification. Pagination validates same-origin next links, ordered pages and progress. Related contacts/companies load by ID in batches of 50. Embedded contacts or entity links preserve all relations and main_contact.

Manual refresh scans the full current-user scope. Core account/pipeline/lead/contact/company/relations are collected before one transaction. Optional tasks/notes/field definitions retain their previous cache on failure and produce partial_error. Core failure keeps previous data. Missing records after a completed scan become unavailable, without hard deletion; stale deals show a label. A failed CRM file export restores the prior in-memory database. Interrupted runs become failed at startup.

Workspace projection groups by company, then contact, then a deal workspace without fabricated contact. Phone/email come from custom values. Closed deals use status IDs 142/143 and closed_at. Currency is displayed only if the API returns it. Responsible identity is shown by verified ID, avoiding an admin-only request.

data_mode selects demo or CRM projection; real mode has no synthetic meetings. CRM tasks are disabled and rejected by native mutation handlers. Startup only reads cache. Disconnect removes secrets first; cache is retained or explicitly purged for that account. Demo reset preserves profile, settings and CRM cache.

Existing meeting/transcript/matching/template and KonturTalkAdapter boundaries remain suitable for Phase 3. Future write-back must use a separate service and explicit review contract.

## Phase 1 foundation (retained)

### Employee browser connection (0.2.1)

Migration 003 adds auth_mode with an OAuth default for existing accounts. The separate official-site BrowserWindow uses an in-memory partition, no preload, sandbox, context isolation, denied permissions/downloads/popups and validated HTTPS navigation. Authentication is completed manually by the user. No form or password extraction is implemented.

BrowserAccess injects a GET-only session.fetch transport into the existing AmoClient. A successful /account identity check precedes encrypted cookie publication and connection metadata. Cookie bundles validate target domain, cookie domains/attributes and bounded sizes. Only own account and official authentication cookies are eligible; other browser profiles are never read. Browser cookie credentials have a separate encrypted namespace. Normal startup does not restore sessions or request network data; restoration occurs on manual sync. Disconnect clears the app's own sessions and both credential forms. A 401 does not call OAuth refresh in browser mode.

This is a capability probe plus conditional API synchronization. Real employee session access is unverified; no DOM parser is included. An unsuccessful probe preserves prior cache. Kontur UI observations are documented in KONTUR_EMPLOYEE_ACCESS.md; its adapter remains pending.

```text
React routes and components
  → typed DesktopApi (preload IPC)
  → Electron application handlers
  → AppRepository / SqliteRepository
  → SQLite file in user data
```

The renderer has no Node.js access. Electron uses context isolation, sandboxing and a narrow preload API. IPC handlers validate the available mutations; application errors are logged and translated into Russian user-facing messages.

`src/domain/models.ts` contains application models independent from React and Electron. `src/services/contracts.ts` defines the typed application service API, persistence contract, `AmoCrmAdapter`, `KonturTalkAdapter`, `AiProvider` and `SecureCredentialStore`. Phase 1 adapters are mocks and do not call networks. Future integration services should depend on these interfaces.

`electron/repository.ts` manages SQLite lifecycle and persistence. `migrations/001_initial.sql` creates the schema, indexes and foreign keys. Each migration is tracked in `schema_migrations` and applied transactionally. `electron/seed.ts` inserts stable fictional entities once. SQL.js executes SQLite within the native Electron process and exports the database to a real SQLite file after mutations. The database is never owned by React state.

The user data folder holds the database and local logs. Secrets have a separate `SecureCredentialStore` implementation using Electron `safeStorage`; no account credentials are saved or used in Phase 1. Tokens must never be inserted into `app_settings` or `integrations`.

The current model can support the later pipeline:

```text
Kontur.Talk meeting → normalized meeting → deal match → selected template
→ structured AI extraction → human review → amoCRM write-back
```

The meeting, deal and client relations, matching status, template fields and adapter contracts provide the basic boundaries. Matching, AI output, review records and write-back are deferred.

## Phase 3 — Kontur.Talk

`electron/kontur` isolates session policy, GET transport, official/session adapters, normalization and sync service. `src/domain/kontur.ts` carries normalized source data; both adapters implement the shared `KonturTalkAdapter`. Main-process IPC authorizes only the main frame and active account's meetings. Remote login pages have no preload.

Migration 004 extends meetings and adds account-scoped source aliases, participants, artifacts, transcript segments and sync runs. No giant transcript is included in the initial snapshot: local pages are bounded to 200 segments, with Unicode search. Unchanged segments keep their IDs and rows; explicit source-hidden text is not exposed. Startup is offline; manual refresh discovers up to 90 recent days and rechecks readiness.

See KONTUR_TALK_INTEGRATION.md for observed endpoints, session isolation, current browser-storage limitations and validation evidence. Source retellings/protocols are displayed unchanged; no AI generation, media download or CRM write occurs.

## Phase 4 — local associations (0.4.0)

React MeetingCrmMatch → narrow preload matching IPC → SqliteRepository → MatchingIndex and matching persistence. Source authentication and network transports are unchanged. The engine only reads the local current-manager CRM projection and source materials. No external AI or write operations are introduced. Migration 005 creates authoritative links, candidate/evidence JSON, indexed references and history. The logical meeting owns the mapping; late recording merges transfer confirmed links and preserve conflicting choices in history. Repository commits recalculate proposals; confirmation/reassignment/unlink use atomic local transactions. Snapshot projects confirmed client/deal IDs for workspace navigation and a bounded source retelling preview. Referenced transcript IDs resolve to a bounded page offset through authorized IPC. See MEETING_CRM_MATCHING.md for weights, normalization, contradictions and invariants.

## Phase 5 — workspace and write-back (0.5.0)

```text
React (EntityCard, StageControl, TaskForm, NoteComposer) → useCrmWrite → DesktopApi.writeCrm
→ preload → IPC crm:write (main frame only) → CrmService.execute
→ validateCommand(WriteContext from SQLite cache) → crm_operations 'sending'
→ performMutation: GET fresh → conflictingKeys → entityPayload/fieldPayload → AmoClient.send (shared Transport limiter, OAuth single-flight or browser session)
→ GET result → repository.putCrmEntity → crm_operations 'confirmed' → renderer reloads snapshot
```

`src/domain/crmWrite.ts` defines `CrmCommand` (entity.update, task.create/update/complete, note.create/update), statuses and the shared `comparable()` used for conflict originals. `electron/amocrm/writes.ts` holds pure validation and payload building; `mutations.ts` executes commands, reconciles ambiguous creates, and collects scoped workspace refreshes and history events. `security.ts` adds a separate mutation allowlist (`writeEndpoint`); `Transport.send` retries only 429 and idempotent PATCH 5xx. Repository additions: `writeContext`, `putCrmEntity`, `mergeScoped` (entity-level refresh that never marks unrelated records unavailable), operation audit and event cache. Migration 006: `crm_operations`, `crm_events`, `crm_event_loads`, `crm_field_groups`.

`src/domain/workspace.ts` maps field metadata to editors and back to minimal `FieldChange`s and converts local wall-clock time to amoCRM unix seconds; `src/domain/timeline.ts` normalizes events and composes the feed. The browser preview uses `previewWrites.ts` on synthetic data only. Future AI or template proposals must build the same `CrmCommand` and go through `crm:write` after human approval.

## Phase 6 — conversations (0.6.0)

`sync.ts → collectTalks` reads the official `GET /api/v4/talks` (filtered by synchronized contacts) as an optional sync step and in scoped workspace refresh; `crmPersistence` stores `crm_talks` (migration 007) idempotently by `talk_id`. Renderer: `src/domain/talks.ts`, `components/workspace/Conversations.tsx` (Чат tab), `pages/Messages.tsx` (inbox). `crm:openInAmo` opens the official amoCRM card for a cached lead/contact. No message bodies, no sending, no session-based private endpoints. See MESSAGING_ARCHITECTURE.md.
