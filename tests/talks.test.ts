// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqliteRepository } from '../electron/repository.ts';
import { AmoClient } from '../electron/amocrm/client.ts';
import { Transport } from '../electron/amocrm/transport.ts';
import { collectTalks, mapTalk } from '../electron/amocrm/sync.ts';
import { channelLabel, talkTitle, talksForContacts, unreadCount } from '../src/domain/talks.ts';
import { accountFixture, batchFixture } from './crmFixture.ts';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
const talk = (id: number, contact: number, origin = 'telegram', extra: Record<string, unknown> = {}) => ({ talk_id: id, chat_id: `chat-${id}`, contact_id: contact, entity_id: 10, entity_type: 'lead', origin, source_id: 1, status: 'in_work', is_in_work: true, is_read: false, created_at: 1700000000 + id, updated_at: 1700001000 + id, ...extra });

describe('Talks API discovery', () => {
  it('paginates, filters by synchronized contacts and ignores foreign contacts', async () => {
    const urls: URL[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => { void _init; const u = new URL(String(input)); urls.push(u); const page = Number(u.searchParams.get('page'));
      return json(page === 1 ? { _embedded: { talks: [talk(1, 20), talk(2, 20, 'whatsapp'), talk(3, 999)] }, _links: { next: { href: 'x' } } } : { _embedded: { talks: [talk(4, 21, 'viber')] } }); });
    const client = new AmoClient('test.amocrm.ru', null, new Transport(fetcher as typeof fetch, async () => {}));
    const result = await collectTalks(client, [20, 21]);
    expect(result.map(t => t.talkId)).toEqual([1, 2, 4]);
    expect(urls[0].pathname).toBe('/api/v4/talks'); expect(urls[0].searchParams.get('filter[contact_id][0]')).toBe('20'); expect(urls[0].searchParams.get('limit')).toBe('250');
    expect(fetcher.mock.calls.every(c => !c[1]?.method || c[1].method === 'GET')).toBe(true);
  });
  it('validates items and never fabricates relationships', () => {
    expect(mapTalk({ talk_id: 5, contact_id: null, entity_id: null, origin: 'custom.thing', is_read: true })).toMatchObject({ talkId: 5, contactId: null, entityId: null, origin: 'custom.thing', isRead: true, isInWork: false });
    expect(() => mapTalk({ talk_id: 'x' })).toThrow();
  });
  it('labels channels, distinguishes several sources of one messenger and keeps unknown channels', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp'); expect(channelLabel('telegram')).toBe('Telegram'); expect(channelLabel('com.amocrm.custom.origin_23')).toBe('Другой канал'); expect(channelLabel(null)).toBe('Другой канал');
    const a = mapTalk(talk(1, 20, 'whatsapp', { source_id: 11 })); const b = mapTalk(talk(2, 20, 'whatsapp', { source_id: 12 })); const c = mapTalk(talk(3, 20, 'telegram'));
    expect([talkTitle(a, [a, b, c]), talkTitle(b, [a, b, c]), talkTitle(c, [a, b, c])]).toEqual(['WhatsApp · источник 1', 'WhatsApp · источник 2', 'Telegram']);
    expect(talksForContacts([a, b, c, mapTalk(talk(4, 30))], [20]).map(t => t.talkId)).toEqual([3, 2, 1]); expect(unreadCount([a, { ...b, isRead: true }])).toBe(1);
  });
});

describe('talk persistence', () => {
  let dir: string; let repo: SqliteRepository;
  beforeEach(async () => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talkcrm-talks-')); repo = new SqliteRepository(path.join(dir, 'db.sqlite'), path.join(process.cwd(), 'migrations'), process.cwd()); await repo.initialize(); await repo.connectAccount(accountFixture); });
  afterEach(() => { repo.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  it('stores talks idempotently, marks vanished ones unavailable and survives restart', async () => {
    const t1 = mapTalk(talk(1, 20)), t2 = mapTalk(talk(2, 20, 'whatsapp'));
    await repo.commitCrmSync({ ...batchFixture(), talks: [t1, t2] }, await repo.startSync());
    await repo.commitCrmSync({ ...batchFixture(), talks: [{ ...t1, isRead: true }] }, await repo.startSync());
    repo.close(); repo = new SqliteRepository(path.join(dir, 'db.sqlite'), path.join(process.cwd(), 'migrations'), process.cwd()); await repo.initialize();
    const talks = (await repo.snapshot()).crm?.talks ?? [];
    expect(talks).toHaveLength(2); expect(talks.find(t => t.talkId === 1)).toMatchObject({ isRead: true, availability: 'active' }); expect(talks.find(t => t.talkId === 2)?.availability).toBe('unavailable');
  });
  it('keeps the previous talk cache when the optional talks step was not returned', async () => {
    await repo.commitCrmSync({ ...batchFixture(), talks: [mapTalk(talk(1, 20))] }, await repo.startSync());
    await repo.commitCrmSync(batchFixture(), await repo.startSync());
    expect((await repo.snapshot()).crm?.talks?.[0]).toMatchObject({ talkId: 1, availability: 'active' });
  });
  it('migrates a 0.5.0 database to version 7 without touching existing data', async () => {
    repo.close(); const oldDir = path.join(dir, 'old'); fs.mkdirSync(oldDir);
    for (const f of fs.readdirSync(path.join(process.cwd(), 'migrations')).filter(f => !f.startsWith('007'))) fs.copyFileSync(path.join(process.cwd(), 'migrations', f), path.join(oldDir, f));
    const file = path.join(dir, 'legacy.sqlite'); const legacy = new SqliteRepository(file, oldDir, process.cwd()); await legacy.initialize(); await legacy.connectAccount(accountFixture); await legacy.commitCrmSync(batchFixture(), await legacy.startSync()); const before = await legacy.snapshot(); legacy.close();
    repo = new SqliteRepository(file, path.join(process.cwd(), 'migrations'), process.cwd()); await repo.initialize(); const after = await repo.snapshot();
    expect(after.deals).toEqual(before.deals); expect(after.tasks).toEqual(before.tasks); expect(after.crm?.notes).toEqual(before.crm?.notes); expect(after.crm?.talks).toEqual([]);
    const SQL = await (await import('sql.js')).default(); const db = new SQL.Database(fs.readFileSync(file)); expect(db.exec('SELECT MAX(version) FROM schema_migrations')[0].values[0][0]).toBe(7); db.close();
  });
});
