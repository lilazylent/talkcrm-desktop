# TalkCRM Desktop

TalkCRM Desktop 0.4.0 is a local Windows workspace on Electron, React, TypeScript and SQLite. Phase 3 adds Kontur.Talk through an isolated employee session (including Yandex sign-in) or an administrator-issued official API key. Internal meetings work without client matching. The employee session was verified on four recordings: three meetings, 891 transcript segments and four retellings. Protocols were unavailable at the source. Live official API key validation remains pending.

amoCRM and its existing read-only integration are preserved. Real and demo data are separate. Phase 4 adds local meeting/client/deal proposals with explanations and mandatory human confirmation. AI generation and CRM write-back remain later work.

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

See [architecture](docs/ARCHITECTURE.md) and [roadmap](docs/ROADMAP.md).
