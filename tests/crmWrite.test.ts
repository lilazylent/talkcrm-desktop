// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteRepository } from '../electron/repository.ts';
import { CrmService } from '../electron/amocrm/service.ts';
import { Transport } from '../electron/amocrm/transport.ts';
import { AmoClient } from '../electron/amocrm/client.ts';
import { writeEndpoint } from '../electron/amocrm/security.ts';
import { entityPayload, fieldPayload, validateCommand } from '../electron/amocrm/writes.ts';
import type { BrowserAccess } from '../electron/amocrm/browserAccess.ts';
import type { SecureCredentialStore } from '../src/services/contracts.ts';
import type { CrmAccount, CrmRecord, SyncBatch } from '../src/domain/crm.ts';
import type { CrmCommand } from '../src/domain/crmWrite.ts';
import { comparable } from '../src/domain/crmWrite.ts';

const account: CrmAccount = { id: '1_test', externalId: 1, domain: 'test.amocrm.ru', name: 'Тест', currentUserId: 9, authorized: true, expiresAt: 0, lastSyncAt: null, state: 'idle', error: null, currency: 'RUB', authMode: 'browser' };
const statuses = (list: [number, string][]) => ({ statuses: list.map(([id, name], i) => ({ id, name, sort: i * 10, type: 0 })) });
const fields = [
  { entity: 'leads', definition: { id: 200, name: 'Потребность', type: 'text' } }, { entity: 'leads', definition: { id: 201, name: 'Сотрудников', type: 'numeric' } },
  { entity: 'leads', definition: { id: 202, name: 'Источник', type: 'select', enums: [{ id: 1, value: 'Сайт' }, { id: 2, value: 'Рекомендация' }] } },
  { entity: 'leads', definition: { id: 203, name: 'Модули', type: 'multiselect', enums: [{ id: 11, value: 'Встречи' }, { id: 12, value: 'Задачи' }] } },
  { entity: 'leads', definition: { id: 204, name: 'Договор', type: 'checkbox' } }, { entity: 'leads', definition: { id: 205, name: 'Старт', type: 'date' } },
  { entity: 'leads', definition: { id: 206, name: 'UTM', type: 'tracking_data' } }, { entity: 'leads', definition: { id: 207, name: 'Странное поле', type: 'smart_address_v9' } },
  { entity: 'contacts', definition: { id: 1, name: 'Телефон', type: 'multitext', code: 'PHONE', enums: [{ id: 1, value: 'WORK' }, { id: 3, value: 'MOB' }] } },
  { entity: 'contacts', definition: { id: 2, name: 'Email', type: 'multitext', code: 'EMAIL', enums: [{ id: 7, value: 'WORK' }, { id: 8, value: 'PRIV' }] } },
  { entity: 'contacts', definition: { id: 3, name: 'Должность', type: 'text' } }, { entity: 'companies', definition: { id: 501, name: 'ИНН', type: 'text' } }
];
const lead = (): CrmRecord => ({ id: 10, name: 'Внедрение', responsible_user_id: 9, pipeline_id: 5, status_id: 50, price: 100000, updated_at: 1000, created_at: 900, custom_fields_values: [{ field_id: 200, values: [{ value: 'Пилот' }] }] });
const contact = (): CrmRecord => ({ id: 20, name: 'Ирина', updated_at: 1000, custom_fields_values: [{ field_id: 1, field_code: 'PHONE', values: [{ value: '+7 900 000-00-01', enum_code: 'MOB' }, { value: '+7 495 000-00-02', enum_code: 'WORK' }] }] });
const batch = (): SyncBatch => ({ account: { ...account }, leads: [lead()], contacts: [contact()], companies: [{ id: 30, name: 'ООО Ромашка', updated_at: 1000 }], pipelines: [{ id: 5, name: 'Продажи', _embedded: statuses([[50, 'Переговоры'], [51, 'Согласование'], [142, 'Успешно'], [143, 'Закрыто']]) }, { id: 6, name: 'Партнёры', _embedded: statuses([[60, 'Пилот'], [142, 'Успешно'], [143, 'Закрыто']]) }], relations: [{ leadId: 10, entityType: 'contacts', entityId: 20, primary: true }, { leadId: 10, entityType: 'companies', entityId: 30, primary: false }], tasks: [{ id: 60, text: 'Позвонить', responsible_user_id: 9, entity_type: 'leads', entity_id: 10, is_completed: false, complete_till: 1800000000, task_type_id: 1, updated_at: 1000, created_at: 900 }], notes: [{ id: 70, note_type: 'common', params: { text: 'Старое' }, entity_id: 10, entity_type: 'leads', created_at: 950 }, { id: 71, note_type: 'service_message', params: { text: 'Система' }, entity_id: 10, entity_type: 'leads', created_at: 951 }], fields, taskTypes: [{ id: 1, name: 'Звонок' }, { id: 2, name: 'Встреча' }], warnings: [] });

/** Stateful fake amoCRM: records every request and mutates its entities like the real API would. */
function fakeAmo(options: { status?: (method: string, path: string) => number | undefined; network?: (method: string, path: string) => boolean } = {}) {
  const leads = new Map<number, CrmRecord>([[10, lead()]]); const contacts = new Map<number, CrmRecord>([[20, contact()]]); const companies = new Map<number, CrmRecord>([[30, { id: 30, name: 'ООО Ромашка', updated_at: 1000 }]]);
  const tasks = new Map<number, CrmRecord>([[60, { id: 60, text: 'Позвонить', responsible_user_id: 9, entity_type: 'leads', entity_id: 10, is_completed: false, complete_till: 1800000000, task_type_id: 1, updated_at: 1000, created_at: 900 }]]);
  const notes = new Map<number, CrmRecord>([[70, { id: 70, note_type: 'common', params: { text: 'Старое' }, entity_id: 10, created_at: 950 }]]);
  const calls: { method: string; path: string; body?: unknown }[] = []; let seq = 1000; let clock = 2000;
  const store: Record<string, Map<number, CrmRecord>> = { leads, contacts, companies };
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ method, path: url.pathname, body });
    if (options.network?.(method, url.pathname)) throw new TypeError('network');
    const forced = options.status?.(method, url.pathname); if (forced) return json({ title: 'error' }, forced);
    let m: RegExpExecArray | null;
    if ((m = /^\/api\/v4\/(leads|contacts|companies)\/(\d+)$/.exec(url.pathname))) {
      const item = store[m[1]].get(Number(m[2])); if (!item) return json({}, 404);
      if (method === 'PATCH') { const next = { ...item, ...body, updated_at: ++clock }; if (body.custom_fields_values) { const map = new Map(((item.custom_fields_values as Record<string, unknown>[]) ?? []).map(f => [f.field_id, f])); for (const f of body.custom_fields_values) { if (f.values === null) map.delete(f.field_id); else map.set(f.field_id, f); } next.custom_fields_values = [...map.values()]; } store[m[1]].set(item.id, next); return json({ id: item.id, updated_at: next.updated_at }); }
      return json(item);
    }
    if (url.pathname === '/api/v4/tasks' && method === 'POST') { const id = ++seq; tasks.set(id, { ...body[0], id, is_completed: false, created_at: Math.floor(Date.now() / 1000), updated_at: ++clock }); return json({ _embedded: { tasks: [{ id, request_id: body[0].request_id }] } }); }
    if (url.pathname === '/api/v4/tasks' && method === 'GET') return json({ _embedded: { tasks: [...tasks.values()].filter(t => !url.searchParams.get('filter[entity_id][0]') || t.entity_id === Number(url.searchParams.get('filter[entity_id][0]'))) } });
    if ((m = /^\/api\/v4\/tasks\/(\d+)$/.exec(url.pathname))) { const t = tasks.get(Number(m[1])); if (!t) return json({}, 404); if (method === 'PATCH') { tasks.set(t.id, { ...t, ...body, updated_at: ++clock }); return json({ id: t.id }); } return json(t); }
    if ((m = /^\/api\/v4\/(leads|contacts|companies)\/notes$/.exec(url.pathname)) && method === 'POST') { const id = ++seq; notes.set(id, { id, note_type: body[0].note_type, params: body[0].params, entity_id: body[0].entity_id, created_at: Math.floor(Date.now() / 1000) }); return json({ _embedded: { notes: [{ id, entity_id: body[0].entity_id, request_id: body[0].request_id }] } }); }
    if ((m = /^\/api\/v4\/(leads|contacts|companies)\/(\d+)\/notes$/.exec(url.pathname))) return json({ _embedded: { notes: [...notes.values()].filter(n => n.entity_id === Number(m![2])) } });
    if ((m = /^\/api\/v4\/(leads|contacts|companies)\/notes\/(\d+)$/.exec(url.pathname))) { const n = notes.get(Number(m[2])); if (!n) return json({}, 404); if (method === 'PATCH') { notes.set(n.id, { ...n, params: body.params }); return json({ id: n.id }); } return json(n); }
    if (url.pathname === '/api/v4/leads') return json({ _embedded: { leads: [...leads.values()].map(l => ({ ...l, _embedded: { contacts: [{ id: 20, is_main: true }], companies: [{ id: 30 }] } })) } });
    if (url.pathname === '/api/v4/contacts') return json({ _embedded: { contacts: [...contacts.values()] } });
    if (url.pathname === '/api/v4/companies') return json({ _embedded: { companies: [...companies.values()] } });
    if (url.pathname === '/api/v4/events') return json({ _embedded: { events: [{ id: '01ev', type: 'lead_status_changed', entity_type: 'lead', entity_id: 10, created_at: 1500, value_before: [{ lead_status: { id: 50, pipeline_id: 5 } }], value_after: [{ lead_status: { id: 51, pipeline_id: 5 } }] }] } });
    return json({}, 404);
  });
  return { fetcher, calls, leads, contacts, tasks, notes, writes: () => calls.filter(c => c.method !== 'GET') };
}

let dir: string; let repo: SqliteRepository;
const store: SecureCredentialStore = { set: vi.fn(async () => {}), get: vi.fn(async () => null), delete: vi.fn(async () => {}) };
const serviceFor = (amo: ReturnType<typeof fakeAmo>) => { const browser: BrowserAccess = { open: async () => {}, client: async domain => new AmoClient(domain, null, new Transport(amo.fetcher as typeof fetch, async () => {}), { 'X-Requested-With': 'XMLHttpRequest' }), persist: async () => {}, clear: async () => {}, close: () => {} }; return new CrmService(repo, store, new Transport(vi.fn(), async () => {}), () => {}, browser); };
let op = 0; const id = () => `op-${Date.now()}-${++op}-abcdef`;
const update = (changes: Extract<CrmCommand, { type: 'entity.update' }>['changes'], extra: Partial<Extract<CrmCommand, { type: 'entity.update' }>> = {}): CrmCommand => { const keys = [...(changes.name !== undefined ? ['name'] : []), ...(changes.price !== undefined ? ['price'] : []), ...(changes.statusId !== undefined ? ['status'] : []), ...(changes.fields ?? []).map(f => `field:${f.fieldId}`)]; return { type: 'entity.update', operationId: id(), entity: 'leads', entityId: 10, baseUpdatedAt: 1000, changes, original: Object.fromEntries(keys.map(k => [k, comparable(lead(), k)])), ...extra }; };
beforeEach(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkcrm-write-')); repo = new SqliteRepository(path.join(dir, 'db.sqlite'), path.join(process.cwd(), 'migrations'), process.cwd()); await repo.initialize(); await repo.connectAccount(account); await repo.commitCrmSync(batch(), await repo.startSync()); });
afterEach(() => { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const cachedLead = () => repo.cachedEntity('lead', 10)!;

describe('write endpoint allowlist', () => {
  it('allows only updates and creation; never DELETE or administration', () => {
    expect(() => writeEndpoint('test.amocrm.ru', 'PATCH', '/api/v4/leads/10')).not.toThrow();
    expect(() => writeEndpoint('test.amocrm.ru', 'POST', '/api/v4/tasks')).not.toThrow();
    for (const [m, p] of [['DELETE', '/api/v4/leads/10'], ['POST', '/api/v4/leads'], ['PATCH', '/api/v4/leads/pipelines/5'], ['POST', '/api/v4/leads/custom_fields'], ['PATCH', '/api/v4/users/9'], ['PATCH', '/api/v4/leads/10?x=1'], ['POST', '/api/v4/account']]) expect(() => writeEndpoint('test.amocrm.ru', m, p)).toThrow();
  });
});

describe('field payload mapping', () => {
  const def = (fid: number) => fields.find(f => f.definition.id === fid)!.definition as CrmRecord;
  it.each([
    ['text', 200, [{ value: '  Новая потребность  ' }], [{ value: 'Новая потребность' }]],
    ['numeric', 201, [{ value: '1 250,5' }], [{ value: '1250.5' }]],
    ['select', 202, [{ enum_id: 2 }], [{ enum_id: 2 }]],
    ['multiselect', 203, [{ enum_id: 11 }, { enum_id: 12 }], [{ enum_id: 11 }, { enum_id: 12 }]],
    ['checkbox', 204, [{ value: true }], [{ value: true }]],
    ['date', 205, [{ value: 1767225600 }], [{ value: 1767225600 }]],
    ['phone', 1, [{ value: '+7 900 000-00-01', enum_code: 'MOB' }], [{ value: '+7 900 000-00-01', enum_code: 'MOB' }]],
    ['email', 2, [{ value: 'a@b.ru', enum_code: 'WORK' }], [{ value: 'a@b.ru', enum_code: 'WORK' }]]
  ])('%s: editor value → exact amoCRM payload', (_name, fid, values, expected) => { expect(fieldPayload(def(fid), { fieldId: fid, values })).toEqual({ field_id: fid, values: expected }); });
  it('clears a field with values:null and rejects invented enums, bad numbers, bad emails', () => {
    expect(fieldPayload(def(200), { fieldId: 200, values: null })).toEqual({ field_id: 200, values: null });
    expect(() => fieldPayload(def(202), { fieldId: 202, values: [{ enum_id: 99 }] })).toThrow('из списка amoCRM');
    expect(() => fieldPayload(def(201), { fieldId: 201, values: [{ value: 'много' }] })).toThrow('число');
    expect(() => fieldPayload(def(2), { fieldId: 2, values: [{ value: 'не почта' }] })).toThrow('почты');
    expect(() => fieldPayload(def(1), { fieldId: 1, values: [{ value: '+7 900', enum_code: 'SPACESHIP' }] })).toThrow();
  });
  it('keeps unsupported and unknown field types read-only with no payload', () => {
    expect(() => fieldPayload(def(206), { fieldId: 206, values: [{ value: 'x' }] })).toThrow('только в amoCRM');
    expect(() => fieldPayload(def(207), { fieldId: 207, values: [{ value: 'x' }] })).toThrow('только в amoCRM');
  });
  it('validates stage belongs to pipeline and protects terminal moves', () => {
    const ctx = repo.writeContext();
    expect(() => entityPayload(ctx, 'leads', lead(), { statusId: 60 }, false)).toThrow('не относится');
    expect(() => entityPayload(ctx, 'leads', lead(), { statusId: 142 }, false)).toThrow('Подтвердите');
    expect(entityPayload(ctx, 'leads', lead(), { statusId: 142 }, true)).toEqual({ status_id: 142 });
    expect(entityPayload(ctx, 'leads', lead(), { pipelineId: 6, statusId: 60 }, false)).toEqual({ status_id: 60, pipeline_id: 6 });
    expect(() => entityPayload(ctx, 'leads', lead(), { price: -5 }, false)).toThrow('Бюджет');
    expect(() => entityPayload(ctx, 'contacts', contact(), { statusId: 50 }, false)).toThrow();
  });
});

describe('deal writes', () => {
  it('renames, changes amount and a custom field, sending only changed keys and reconciling from amoCRM', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    const result = await crm.execute(update({ name: 'Внедрение TalkCRM', price: 250000, fields: [{ fieldId: 202, values: [{ enum_id: 1 }] }] }));
    expect(result).toMatchObject({ ok: true, status: 'confirmed', message: 'Сохранено в amoCRM' });
    expect(amo.writes()).toEqual([{ method: 'PATCH', path: '/api/v4/leads/10', body: { name: 'Внедрение TalkCRM', price: 250000, custom_fields_values: [{ field_id: 202, values: [{ enum_id: 1 }] }] } }]);
    expect(cachedLead()).toMatchObject({ name: 'Внедрение TalkCRM', price: 250000 });
    expect((await repo.snapshot()).deals.find(d => d.externalId === '10')?.amount).toBe(250000);
    expect(repo.operationHistory()[0]).toMatchObject({ status: 'confirmed', entity_type: 'leads', entity_external_id: 10, changed_fields: ['name', 'price', 'field:202'] });
  });
  it('changes stage, and requires explicit confirmation for a terminal stage', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    expect((await crm.execute(update({ statusId: 51 }))).ok).toBe(true);
    expect(cachedLead().status_id).toBe(51);
    const pending = await crm.execute({ ...update({ statusId: 142 }), baseUpdatedAt: Number(cachedLead().updated_at), original: { status: comparable(cachedLead(), 'status') } });
    expect(pending).toMatchObject({ ok: false, status: 'pending' }); expect(amo.writes()).toHaveLength(1);
    expect((await crm.execute({ ...update({ statusId: 142 }, { confirmTerminal: true }), baseUpdatedAt: Number(cachedLead().updated_at), original: { status: comparable(cachedLead(), 'status') } })).ok).toBe(true);
    expect(cachedLead().status_id).toBe(142);
  });
  it('reports a permission rejection in Russian, keeps cache and never retries', async () => {
    const amo = fakeAmo({ status: m => m === 'PATCH' ? 403 : undefined }); const crm = serviceFor(amo);
    const result = await crm.execute(update({ price: 1 }));
    expect(result).toMatchObject({ ok: false, status: 'failed', message: 'У вас нет прав на это изменение в amoCRM.' });
    expect(amo.writes()).toHaveLength(1); expect(cachedLead().price).toBe(100000);
    expect(repo.operationHistory()[0]).toMatchObject({ status: 'failed', error_category: 'write_403' });
  });
  it('detects a stale conflict on the edited key and refreshes the cache instead of overwriting', async () => {
    const amo = fakeAmo(); amo.leads.set(10, { ...lead(), price: 777, updated_at: 1500 }); const crm = serviceFor(amo);
    const result = await crm.execute(update({ price: 250000 }));
    expect(result).toMatchObject({ ok: false, status: 'conflict', message: 'Карточка изменилась в amoCRM.' });
    expect(amo.writes()).toHaveLength(0); expect(cachedLead().price).toBe(777);
  });
  it('safely merges when amoCRM changed a different key since the card was opened', async () => {
    const amo = fakeAmo(); amo.leads.set(10, { ...lead(), name: 'Переименовано коллегой', updated_at: 1500 }); const crm = serviceFor(amo);
    expect((await crm.execute(update({ price: 250000 }))).ok).toBe(true);
    expect(amo.writes()[0].body).toEqual({ price: 250000 }); expect(cachedLead()).toMatchObject({ name: 'Переименовано коллегой', price: 250000 });
  });
  it('blocks writes while disconnected and keeps cached data', async () => {
    await repo.markCrmUnauthorized('x'); const amo = fakeAmo(); const crm = serviceFor(amo);
    expect(await crm.execute(update({ price: 5 }))).toMatchObject({ ok: false, message: 'Нет подключения к amoCRM. Данные доступны только для просмотра.' });
    expect(amo.calls).toHaveLength(0);
  });
  it('treats network failure of an update as not saved', async () => {
    const amo = fakeAmo({ network: m => m === 'PATCH' }); const crm = serviceFor(amo);
    expect(await crm.execute(update({ price: 5 }))).toMatchObject({ ok: false, status: 'failed', message: 'Нет соединения с amoCRM. Изменение не сохранено.' });
    expect(cachedLead().price).toBe(100000);
  });
});

describe('contact and company writes', () => {
  const contactUpdate = (changes: Extract<CrmCommand, { type: 'entity.update' }>['changes']): CrmCommand => ({ type: 'entity.update', operationId: id(), entity: 'contacts', entityId: 20, baseUpdatedAt: 1000, changes, original: Object.fromEntries([...(changes.name !== undefined ? ['name'] : []), ...(changes.fields ?? []).map(f => `field:${f.fieldId}`)].map(k => [k, comparable(contact(), k)])) });
  it('edits name, preserves every phone with its subtype, adds email and a custom field', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    const phones = [{ value: '+7 900 000-00-01', enum_code: 'MOB' }, { value: '+7 495 000-00-02', enum_code: 'WORK' }, { value: '+7 916 000-00-03', enum_code: 'WORK' }];
    expect((await crm.execute(contactUpdate({ name: 'Ирина Волкова', fields: [{ fieldId: 1, values: phones }, { fieldId: 2, values: [{ value: 'irina@example.test', enum_code: 'WORK' }] }, { fieldId: 3, values: [{ value: 'Директор' }] }] }))).ok).toBe(true);
    expect(amo.writes()[0].body).toEqual({ name: 'Ирина Волкова', custom_fields_values: [{ field_id: 1, values: phones }, { field_id: 2, values: [{ value: 'irina@example.test', enum_code: 'WORK' }] }, { field_id: 3, values: [{ value: 'Директор' }] }] });
    const saved = repo.cachedEntity('contact', 20)!; expect((saved.custom_fields_values as CrmRecord[]).find(f => (f as Record<string, unknown>).field_id === 1)).toMatchObject({ values: phones });
  });
  it('edits company name and a company custom field', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    expect((await crm.execute({ type: 'entity.update', operationId: id(), entity: 'companies', entityId: 30, baseUpdatedAt: 1000, changes: { name: 'ООО «Ромашка Плюс»', fields: [{ fieldId: 501, values: [{ value: '7701234567' }] }] }, original: { name: 'ООО Ромашка', 'field:501': '' } })).ok).toBe(true);
    expect(amo.writes()[0]).toMatchObject({ path: '/api/v4/companies/30', body: { name: 'ООО «Ромашка Плюс»', custom_fields_values: [{ field_id: 501, values: [{ value: '7701234567' }] }] } });
    expect(repo.cachedEntity('company', 30)?.name).toBe('ООО «Ромашка Плюс»');
  });
});

describe('task writes', () => {
  it('creates a task on the deal with request_id, current manager and remote id', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo); const command: CrmCommand = { type: 'task.create', operationId: id(), entity: 'leads', entityId: 10, text: 'Отправить договор\nс правками', completeTill: 1900000000, taskTypeId: 2 };
    const result = await crm.execute(command);
    expect(result).toMatchObject({ ok: true, resultId: 1001 });
    expect(amo.writes()[0]).toEqual({ method: 'POST', path: '/api/v4/tasks', body: [{ text: 'Отправить договор\nс правками', complete_till: 1900000000, entity_id: 10, entity_type: 'leads', responsible_user_id: 9, request_id: command.operationId, task_type_id: 2 }] });
    const task = (await repo.snapshot()).tasks.find(t => t.externalId === '1001'); expect(task).toMatchObject({ title: 'Отправить договор\nс правками', completed: false, taskTypeId: 2 });
  });
  it('edits text, reschedules and changes type without recreating the task', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    expect((await crm.execute({ type: 'task.update', operationId: id(), taskId: 60, baseUpdatedAt: 1000, text: 'Позвонить в 15:00', completeTill: 1800003600, taskTypeId: 2 })).ok).toBe(true);
    expect(amo.writes()).toEqual([{ method: 'PATCH', path: '/api/v4/tasks/60', body: { text: 'Позвонить в 15:00', complete_till: 1800003600, task_type_id: 2 } }]);
    expect(repo.cachedEntity('task', 60)).toMatchObject({ text: 'Позвонить в 15:00', complete_till: 1800003600 });
  });
  it('completes remotely with a result; completion survives a reopen of the database', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    expect((await crm.execute({ type: 'task.complete', operationId: id(), taskId: 60, baseUpdatedAt: 1000, result: 'Договорились 👍' })).ok).toBe(true);
    expect(amo.writes()[0].body).toEqual({ is_completed: true, result: { text: 'Договорились 👍' } });
    repo.close(); repo = new SqliteRepository(path.join(dir, 'db.sqlite'), path.join(process.cwd(), 'migrations'), process.cwd()); await repo.initialize();
    expect((await repo.snapshot()).tasks.find(t => t.externalId === '60')).toMatchObject({ completed: true, resultText: 'Договорились 👍' });
    expect(repo.operationHistory()[0]).toMatchObject({ operation_type: 'task.complete', status: 'confirmed' });
  });
  it('rejects editing or completing an already completed task', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo); await crm.execute({ type: 'task.complete', operationId: id(), taskId: 60, baseUpdatedAt: 1000, result: '' });
    expect(await crm.execute({ type: 'task.update', operationId: id(), taskId: 60, baseUpdatedAt: null, text: 'x' })).toMatchObject({ ok: false, message: 'Выполненную задачу нельзя изменить.' });
  });
  it('prevents duplicate clicks: same operation id is sent once, concurrent duplicates are refused', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo); const command: CrmCommand = { type: 'task.create', operationId: id(), entity: 'leads', entityId: 10, text: 'Один раз', completeTill: 1900000000, taskTypeId: 1 };
    const [first, second] = await Promise.all([crm.execute(command), crm.execute({ ...command, operationId: id() })]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1); expect(second.message).toBe('Дождитесь сохранения предыдущего изменения.');
    expect(await crm.execute(command)).toMatchObject({ ok: true, message: 'Уже сохранено в amoCRM' });
    expect(await crm.execute({ ...command, operationId: id() })).toMatchObject({ ok: true, message: 'Уже сохранено в amoCRM' });
    expect(amo.writes()).toHaveLength(1);
  });
  it('reports permission and network failures without local completion', async () => {
    for (const amo of [fakeAmo({ status: m => m === 'PATCH' ? 403 : undefined }), fakeAmo({ network: m => m === 'PATCH' })]) {
      const crm = serviceFor(amo); const result = await crm.execute({ type: 'task.complete', operationId: id(), taskId: 60, baseUpdatedAt: 1000, result: '' });
      expect(result.ok).toBe(false); expect(repo.cachedEntity('task', 60)?.is_completed).toBe(false);
    }
  });
  it('reconciles an ambiguous create instead of re-sending it', async () => {
    const amo = fakeAmo(); const original = amo.fetcher.getMockImplementation()!;
    amo.fetcher.mockImplementationOnce(async (input, init) => { await original(input, init); throw new TypeError('lost response'); });
    const crm = serviceFor(amo); const result = await crm.execute({ type: 'task.create', operationId: id(), entity: 'leads', entityId: 10, text: 'Потерянный ответ', completeTill: 1900000000, taskTypeId: 1 });
    expect(result).toMatchObject({ ok: true, resultId: 1001 }); expect(amo.writes()).toHaveLength(1);
  });
});

describe('note writes', () => {
  it('creates a common note on the deal, persists the remote id and makes only it editable', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo);
    const result = await crm.execute({ type: 'note.create', operationId: id(), entity: 'leads', entityId: 10, text: 'TalkCRM test — «кавычки», ёлки\nвторая строка' });
    expect(result).toMatchObject({ ok: true, resultId: 1001 });
    expect(amo.writes()[0]).toMatchObject({ path: '/api/v4/leads/notes', body: [{ entity_id: 10, note_type: 'common', params: { text: 'TalkCRM test — «кавычки», ёлки\nвторая строка' } }] });
    const snap = await repo.snapshot(); expect(snap.crm?.editableNotes).toEqual(['leads:1001']); expect(snap.crm?.notes.some(n => n.id === 1001 && n.entity_type === 'leads')).toBe(true);
    expect((await crm.execute({ type: 'note.update', operationId: id(), entity: 'leads', entityId: 10, noteId: 1001, text: 'Исправлено' })).ok).toBe(true);
    expect(amo.writes()[1]).toEqual({ method: 'PATCH', path: '/api/v4/leads/notes/1001', body: { note_type: 'common', params: { text: 'Исправлено' } } });
  });
  it('keeps amoCRM-created and system notes read-only', async () => {
    const crm = serviceFor(fakeAmo());
    for (const noteId of [70, 71]) expect(await crm.execute({ type: 'note.update', operationId: id(), entity: 'leads', entityId: 10, noteId, text: 'x' })).toMatchObject({ ok: false, message: 'Это примечание нельзя изменить в TalkCRM.' });
  });
  it('suppresses a duplicate submit of the same note and never shows a failed creation as success', async () => {
    const amo = fakeAmo(); const crm = serviceFor(amo); const base = { type: 'note.create' as const, entity: 'leads' as const, entityId: 10, text: 'Один раз' };
    await crm.execute({ ...base, operationId: id() }); expect(await crm.execute({ ...base, operationId: id() })).toMatchObject({ ok: true, message: 'Уже сохранено в amoCRM' }); expect(amo.writes()).toHaveLength(1);
    const failing = fakeAmo({ status: m => m === 'POST' ? 400 : undefined }); const result = await serviceFor(failing).execute({ ...base, text: 'Не сохранится', operationId: id() });
    expect(result).toMatchObject({ ok: false, status: 'failed' }); expect((await repo.snapshot()).crm?.notes.some(n => (n.params as { text?: string })?.text === 'Не сохранится')).toBe(false);
  });
  it('rejects empty notes before any request', async () => {
    const amo = fakeAmo(); expect(await serviceFor(amo).execute({ type: 'note.create', operationId: id(), entity: 'leads', entityId: 10, text: '   ' })).toMatchObject({ ok: false, message: 'Заполните поле «Примечание».' }); expect(amo.calls).toHaveLength(0);
  });
});

describe('workspace refresh and history', () => {
  it('refreshes only the workspace entities and caches normalized history events', async () => {
    const amo = fakeAmo(); amo.leads.set(10, { ...lead(), name: 'Изменено в amoCRM', updated_at: 3000 }); const crm = serviceFor(amo);
    const clientId = (await repo.snapshot()).clients[0].id;
    expect((await crm.refreshWorkspace(clientId)).ok).toBe(true);
    expect(cachedLead().name).toBe('Изменено в amoCRM'); expect(amo.calls.every(c => c.method === 'GET')).toBe(true);
    expect(amo.calls.some(c => c.path === '/api/v4/leads/pipelines' || c.path.endsWith('/custom_fields'))).toBe(false);
    const timeline = crm.timeline(clientId); expect(timeline.events.map(e => e.type)).toContain('lead_status_changed'); expect(timeline.loadedAt).not.toBeNull();
  });
  it('validates commands against cached metadata', () => {
    const ctx = repo.writeContext();
    expect(() => validateCommand({ type: 'task.create', operationId: id(), entity: 'leads', entityId: 999, text: 'x', completeTill: 1900000000 }, ctx)).toThrow('не найдена');
    expect(() => validateCommand({ type: 'task.create', operationId: id(), entity: 'leads', entityId: 10, text: 'x', completeTill: 12 }, ctx)).toThrow('дату');
    expect(() => validateCommand({ type: 'task.create', operationId: id(), entity: 'leads', entityId: 10, text: 'x', completeTill: 1900000000, taskTypeId: 77 }, ctx)).toThrow('тип задачи');
    expect(() => validateCommand({ type: 'drop.everything', operationId: id() }, ctx)).toThrow();
  });
});

describe('migration from 0.4.0', () => {
  it('adds write-back tables without touching existing CRM cache, meetings, links or settings', async () => {
    repo.close(); const oldDir = path.join(dir, 'old-migrations'); fs.mkdirSync(oldDir);
    for (const file of fs.readdirSync(path.join(process.cwd(), 'migrations')).filter(f => !f.startsWith('006'))) fs.copyFileSync(path.join(process.cwd(), 'migrations', file), path.join(oldDir, file));
    const legacyFile = path.join(dir, 'legacy.sqlite'); const legacy = new SqliteRepository(legacyFile, oldDir, process.cwd()); await legacy.initialize(); await legacy.connectAccount(account); await legacy.commitCrmSync(batch(), await legacy.startSync());
    const before = await legacy.snapshot(); legacy.close();
    const tables = ['crm_entities', 'crm_fields', 'crm_relations', 'meetings', 'meeting_crm_links', 'meeting_crm_link_history', 'transcript_segments', 'app_settings', 'users'];
    const initSqlJs = (await import('sql.js')).default; const SQL = await initSqlJs(); const dump = (file: string) => { const db = new SQL.Database(fs.readFileSync(file)); const out = Object.fromEntries(tables.map(t => [t, JSON.stringify(db.exec(`SELECT * FROM ${t}`))])); db.close(); return out; };
    const rowsBefore = dump(legacyFile);
    repo = new SqliteRepository(legacyFile, path.join(process.cwd(), 'migrations'), process.cwd()); await repo.initialize();
    const rowsAfter = dump(legacyFile); for (const t of tables) expect(rowsAfter[t]).toBe(rowsBefore[t]);
    const after = await repo.snapshot(); expect(after.deals).toEqual(before.deals); expect(after.crm?.notes).toEqual(before.crm?.notes);
    const db = new SQL.Database(fs.readFileSync(legacyFile)); expect(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0]).toBe(7);
    expect(db.exec("SELECT name FROM sqlite_master WHERE name IN ('crm_operations','crm_events','crm_event_loads','crm_field_groups') ORDER BY name")[0].values.flat()).toEqual(['crm_event_loads', 'crm_events', 'crm_field_groups', 'crm_operations']); db.close();
  });
});
