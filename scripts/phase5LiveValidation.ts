// Phase 5 live validation on the user's real profile, using the application's own services.
//   --read  : backup → migration 006 → amoCRM read sync → scoped workspace refresh + history → Kontur regression.
//   --write : only with TALKCRM_SAFE_LEAD=<deal id the user designated as a test record>; minimal note/task sequence.
// Reports contain counts, ids and statuses only — no customer names, notes or transcript text.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { app } from 'electron';
import { SqliteRepository } from '../electron/repository.ts';
import { CrmService } from '../electron/amocrm/service.ts';
import { Transport } from '../electron/amocrm/transport.ts';
import { ElectronBrowserAccess } from '../electron/amocrm/browserAccess.ts';
import { ElectronCredentialStore } from '../electron/credentialStore.ts';
import { TalkSession } from '../electron/kontur/session.ts';
import { KonturService } from '../electron/kontur/service.ts';
import type { CrmCommand } from '../src/domain/crmWrite.ts';

const root = process.env.TALKCRM_QA_ROOT ?? process.cwd(); const userData = path.join(app.getPath('appData'), 'TalkCRM Desktop'); app.setPath('userData', userData);
const mode = process.argv.includes('--write') ? 'write' : 'read'; const output = path.join(root, `docs/validation/phase5-live-${mode}.json`);
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const log: string[] = []; const httpLog = (line: string) => log.push(line.replace(/request=\S+ /, ''));

app.whenReady().then(async () => {
  let repository: SqliteRepository | null = null; let talk: TalkSession | null = null;
  try {
    const database = path.join(userData, 'talkcrm.sqlite');
    const backupDir = path.join(userData, 'backups', `phase5-${new Date().toISOString().slice(0, 10)}`); fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `talkcrm-before-${mode}.sqlite`); if (!fs.existsSync(backup)) fs.copyFileSync(database, backup);
    repository = new SqliteRepository(database, path.join(root, 'migrations'), root, '0.5.0'); await repository.initialize();
    const store = new ElectronCredentialStore(path.join(userData, 'credentials'));
    const crm = new CrmService(repository, store, new Transport(fetch, undefined, undefined, httpLog), () => {}, new ElectronBrowserAccess(store, httpLog));
    const counts = async () => { const s = await repository!.snapshot(); let segments = 0; for (const m of s.meetings) segments += repository!.getTranscriptPage(m.id, 0, 1, '').total; return { deals: s.crm?.leads?.length ?? 0, contacts: s.crm?.contacts.length ?? 0, companies: s.crm?.companies.length ?? 0, fields: s.crm?.fields.length ?? 0, tasks: s.tasks.length, notes: s.crm?.notes.length ?? 0, taskTypes: s.crm?.taskTypes?.length ?? 0, meetings: s.meetings.length, segments, confirmedLinks: s.meetings.filter(m => m.crmLink?.confirmed).length, settings: digest(s.settings), profile: digest(s.profile) }; };
    if (mode === 'read') {
      const before = await counts();
      const sync = await crm.sync(); const afterSync = await counts();
      const snap = await repository.snapshot(); const client = [...snap.clients].sort((a, b) => snap.deals.filter(d => d.clientId === b.id).length - snap.deals.filter(d => d.clientId === a.id).length)[0];
      const refresh = client ? await crm.refreshWorkspace(client.id) : { ok: false, message: 'no client' };
      const timeline = client ? crm.timeline(client.id) : { events: [], loadedAt: null, error: null };
      const eventTypes: Record<string, number> = {}; for (const e of timeline.events) { const t = /^custom_field_\d+_value_changed$/.test(String(e.type)) ? 'custom_field_*_value_changed' : String(e.type); eventTypes[t] = (eventTypes[t] ?? 0) + 1; }
      talk = new TalkSession(); const kontur = new KonturService(repository, store, talk);
      const konturAccount = repository.getKonturAccount(); const meetingIds = snap.meetings.map(m => m.id).sort();
      const konturConnect = konturAccount ? await kontur.connect({ mode: 'session', domain: konturAccount.domain }) : { ok: false, message: 'no kontur account' };
      const konturSync = konturConnect.ok ? await kontur.sync() : konturConnect; const afterKontur = await counts();
      const report = { version: '0.5.0', mode, before, crmSync: { ok: sync.ok, message: sync.ok ? 'ok' : sync.message }, afterSync, workspaceRefresh: { ok: refresh.ok, message: refresh.message, dealsInClient: client ? snap.deals.filter(d => d.clientId === client.id).length : 0, clientHasCompany: !!client?.companyId }, history: { events: timeline.events.length, loadedAt: timeline.loadedAt, error: timeline.error, eventTypes }, kontur: { connect: konturConnect.ok, sync: konturSync.ok, message: konturSync.ok ? 'ok' : konturSync.message, meetingIdsStable: JSON.stringify(meetingIds) === JSON.stringify((await repository.snapshot()).meetings.map(m => m.id).sort()) }, afterKontur, operations: repository.operationHistory().length, http: log.filter(l => !l.includes('method=GET')).length === 0 ? 'GET only' : 'unexpected non-GET', checkedAt: new Date().toISOString() };
      fs.writeFileSync(output, JSON.stringify(report, null, 2));
    } else {
      const leadId = Number(process.env.TALKCRM_SAFE_LEAD); if (!Number.isSafeInteger(leadId) || leadId <= 0) throw new Error('TALKCRM_SAFE_LEAD is required for write validation');
      const snap = await repository.snapshot(); const deal = snap.deals.find(d => d.externalId === String(leadId)); if (!deal) throw new Error('Safe deal is not in the cache of the current manager');
      const steps: { step: string; ok: boolean; status: string; message: string; resultId?: number }[] = [];
      const run = async (step: string, command: CrmCommand) => { const r = await crm.execute(command); steps.push({ step, ok: r.ok, status: r.status, message: r.message, resultId: r.resultId }); if (!r.ok) throw new Error(`${step}: ${r.message}`); return r; };
      await crm.refreshWorkspace(deal.clientId);
      const note = await run('note.create', { type: 'note.create', operationId: randomUUID(), entity: 'leads', entityId: leadId, text: 'TalkCRM test 0.5.0 — проверка записи примечания' });
      const due = new Date(); due.setDate(due.getDate() + 1); due.setHours(10, 0, 0, 0);
      const task = await run('task.create', { type: 'task.create', operationId: randomUUID(), entity: 'leads', entityId: leadId, text: 'TalkCRM test 0.5.0 — проверка задачи', completeTill: Math.floor(due.getTime() / 1000), taskTypeId: null });
      const cachedTask = repository.cachedEntity('task', task.resultId!);
      await run('task.reschedule', { type: 'task.update', operationId: randomUUID(), taskId: task.resultId!, baseUpdatedAt: Number(cachedTask?.updated_at) || null, completeTill: Math.floor(due.getTime() / 1000) + 86400 });
      await run('task.complete', { type: 'task.complete', operationId: randomUUID(), taskId: task.resultId!, baseUpdatedAt: Number(repository.cachedEntity('task', task.resultId!)?.updated_at) || null, result: 'TalkCRM test 0.5.0 — выполнено' });
      const refresh = await crm.refreshWorkspace(deal.clientId); const after = await repository.snapshot();
      const finalTask = after.tasks.find(t => t.externalId === String(task.resultId)); const finalNote = after.crm?.notes.find(n => n.id === note.resultId);
      fs.writeFileSync(output, JSON.stringify({ version: '0.5.0', mode, leadId, steps, reconciled: { refresh: refresh.ok, taskCompleted: finalTask?.completed === true, taskResultSaved: !!finalTask?.resultText, noteCached: !!finalNote, noteEditable: (after.crm?.editableNotes ?? []).includes(`leads:${note.resultId}`) }, operations: repository.operationHistory(10).map(o => ({ type: o.operation_type, status: o.status, fields: o.changed_fields })), checkedAt: new Date().toISOString() }, null, 2));
    }
  } catch (error) { fs.writeFileSync(output, JSON.stringify({ ok: false, mode, message: error instanceof Error ? error.message : 'Validation failed', http: log.slice(-20) }, null, 2)); app.exitCode = 1; }
  finally { talk?.close(); repository?.close(); app.quit(); }
});
