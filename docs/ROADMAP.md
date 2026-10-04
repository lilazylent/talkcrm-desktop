# Roadmap

## Phase 1 — desktop foundation

Executable Windows workspace, SQLite migrations, Russian demo UI, local task/profile/settings persistence, integration interfaces and tests.

## Phase 2 — read-only amoCRM (implementation and acceptance)

- amoCRM OAuth, Windows DPAPI credentials, atomic single-flight rotation.
- Current-user deals, contacts, companies, pipelines, tasks, notes and custom fields.
- Offline cache, demo separation, migration 002 and installer upgrade.
- Employee browser login and cookie-session API synchronization in 0.2.1, migration 003; employee read access has since been validated on the real account. DOM extraction is not implemented.
- Regression in 0.4.0: the installed application refreshes 33 current-manager deals, 33 contacts and 318 fields without CRM write operations.

## Phase 3 — Kontur.Talk dual-mode integration (0.3.0)

- Employee session validated with real internal meetings; separate official API adapter validated against current OpenAPI and synthetic contracts.
- Migration 004, source aliases, exact transcript timing and speakers, source retellings/protocol chunks, local cache and sync journal.
- Five meeting tabs, local search, transcript paging; no automatic client/deal matching.
- Bounded recent discovery, manual incremental updates, retries and safe reconnect/disconnect.
- Live official API key acceptance is not performed because no key is available.

## Phase 4 — local meeting/client/deal associations (0.4.0)

- Deterministic indexed proposals with exact identifiers, safe name/company normalization and source evidence.
- Human confirmation, manual selection, reassignment, unlink confirmation and local history.
- Confirmed-link protection, review warnings, logical-meeting merges, migration 005.
- Meetings filters/batch search, client workspace and deal context, transcript evidence navigation.
- Real internal meetings have no reliable candidates in the current cached CRM scope. No real relationship is automatically confirmed.

## Phase 5 — not started

- CRM workspace/template pipeline and structured extraction based on human-confirmed meeting → client → deal relationships.

## Later phases

- AI structured extraction from meeting transcripts.
- Evidence and timestamps for extracted fields.
- Human review and controlled amoCRM write-back.
- Customer messaging from the client workspace.

No external integration or automatic CRM modification is included in Phase 1.
