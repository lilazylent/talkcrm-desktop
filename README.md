# TalkCRM Desktop

TalkCRM Desktop 0.6.0 is a local Windows workspace on Electron, React, TypeScript and SQLite. Phase 3 adds Kontur.Talk through an isolated employee session (including Yandex sign-in) or an administrator-issued official API key. Internal meetings work without client matching. The employee session was verified on four recordings: three meetings, 891 transcript segments and four retellings. Protocols were unavailable at the source. Live official API key validation remains pending.

Phase 5 (0.5.0) turns the client card into the manager's workspace with safe amoCRM write-back: edit deals (name, budget, stage, custom fields), contacts and companies, create/edit/reschedule/complete tasks, add notes, and see a unified history. amoCRM stays the system of record: every change is validated, sent with only the changed fields, confirmed by amoCRM and reconciled into the cache. Real and demo data are separate. Phase 4 meeting/client/deal proposals still require human confirmation. AI generation, chats and telephony remain later work.

## Prerequisites

- Windows 10 or 11 with Microsoft Edge WebView2 is **not** required: this build uses Electron.
- Node.js 22 LTS or 24 LTS and npm for development.
- Internet access for initial `npm install` and Electron/NSIS tool downloads during packaging.

Electron is the accepted baseline and remains the desktop runtime.

## Development

```powershell
npm install
npm run demo:export
npm run desktop:dev
```

`desktop:dev` starts Vite and the actual Electron application. The browser-only Vite preview serves a static demo fixture to aid visual development; the packaged app requires the Electron preload API and uses SQLite.

## Checks and build

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run desktop:build
```

The Windows installer is written to `release/TalkCRM Setup.exe`. `npm run build` creates production renderer and Electron entry files; `desktop:build` also creates the installer.

## Data and security

The SQLite database is stored under `%APPDATA%\TalkCRM Desktop\talkcrm.sqlite`. Migration 002 preserves Phase 1 profiles, settings and entities. Never delete AppData to upgrade. Resetting demo restores only demo entities, preserving the profile, settings and integration caches. Migration 004 adds source identities, participants, artifacts, transcript segments and a sync journal without deleting existing data.

Connect through **Настройки → Интеграции → amoCRM → Подключить**. Employees can open the official-site browser window, sign in themselves, then verify session read access. Browser mode does not promise API compatibility or DOM parsing until real validation. Alternatively choose **Через интеграцию** and provide OAuth fields. Passwords are entered only on the official website. See [connection instructions](docs/AMOCRM_INTEGRATION.md).

Account-scoped credential bundles are encrypted by Windows DPAPI via Electron safeStorage and stored separately from SQLite. Access/refresh pairs rotate atomically before waiting requests resume. Codes are never persisted. API logs contain method/path/status/timing/correlation only. Startup reads cache without a network request; manual refresh updates it. CRM tasks are read-only in both UI and native handlers. Real mode contains no demo meetings.

## Kontur.Talk

Open **Настройки → Интеграции → Контур.Толк → Подключить**. Select **Обычный вход**, enter your `company.ktalk.ru` workspace, open the official window and sign in manually. Then choose **Проверить подключение и загрузить**. API mode accepts an administrator-issued key. Repeated updates preserve local meeting/segment IDs; startup displays local cache without network requests.

Meetings have five tabs, exact source speakers/timestamps, local Cyrillic text search and bounded transcript pages. Source recording links open in Kontur.Talk. Videos are not downloaded automatically. Disconnect keeps the local cache unless you explicitly select deletion. See [verified contracts and limitations](docs/KONTUR_TALK_INTEGRATION.md).

## Client workspace and amoCRM write-back

Open any client. The header shows contact, phone, email, responsible, deals and quick actions **Добавить задачу** / **Добавить примечание**. Tabs: Обзор, История, Задачи, Встречи. Cards switch to edit mode with **Редактировать**; only changed fields are sent; concurrent amoCRM edits are detected instead of overwritten. Closing a deal requires confirmation. Offline, everything is read-only and nothing is queued. See [CRM workspace](docs/CRM_WORKSPACE.md) and [write safety rules](docs/AMOCRM_WRITE_SAFETY.md). Migration 006 adds the write audit (`crm_operations`), cached history events and field groups without touching existing data.

## Client conversations (0.6.0)

The client workspace has a **Чат** tab and the sidebar a **Сообщения** inbox: conversations of your clients discovered through the official amoCRM Talks API (channel, status, unread, linked deal). Message text and replies stay in amoCRM — **Открыть в amoCRM** opens the right card. Notes, tasks and history stay separate. See [messaging architecture](docs/MESSAGING_ARCHITECTURE.md). Migration 007 adds `crm_talks`.

## Meeting ↔ CRM matching

Open a Kontur meeting and use **Связь с CRM**. **Найти клиента** produces local candidates with confidence and source evidence. Confirm a proposal or search manually by company/contact/deal. A client can be confirmed without a deal. **Изменить связь** and **Убрать связь** change only the local relationship. Confirmed meetings appear in the client workspace and corresponding deal section; transcript reasons navigate to the source segment.

The meetings list supports confirmed/review/unlinked filters and batch proposals. Migration 005 preserves existing data and adds relationships/history; confirmed identity survives source sync and restart. See [matching rules](docs/MEETING_CRM_MATCHING.md).

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/pages` | React screens and interactions |
| `src/components` | Reusable UI elements |
| `src/domain` | Framework independent models and rules |
| `src/services` | Application contracts and mock integration adapters |
| `electron` | Native shell, typed IPC bridge, SQLite repository, seed, logging and credential storage |
| `migrations` | Versioned SQLite schema migrations |
| `tests` | Persistence and critical UI tests |
| `docs` | Architecture and future phase plan |

See [architecture](docs/ARCHITECTURE.md), [design system](docs/DESIGN_SYSTEM.md) and [roadmap](docs/ROADMAP.md).

Version 0.4.1 was a full interface redesign: new design system (Onest + JetBrains Mono, light/dark themes), frameless native window, dashboard with pipeline, meeting workspace with a sticky CRM-match panel, deals board view and Ctrl+K quick search. Data, integrations and migrations are unchanged.
