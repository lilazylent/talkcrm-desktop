// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteRepository } from '../electron/repository.ts';

const root = process.cwd();
let directory: string;
let repository: SqliteRepository;
const file = () => path.join(directory, 'talkcrm.sqlite');
const create = () => new SqliteRepository(file(), path.join(root, 'migrations'), root);

beforeEach(async () => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'talkcrm-test-')); repository = create(); await repository.initialize(); });
afterEach(() => { repository.close(); fs.rmSync(directory, { recursive: true, force: true }); });

describe('SQLite repository', () => {
  it('initializes with a migrated SQLite database and all required entities', async () => {
    expect(fs.readFileSync(file()).subarray(0, 16).toString()).toBe('SQLite format 3\0');
    const data = await repository.snapshot();
    expect(data.profile.displayName).toBe('Алексей Смирнов');
    expect(data.clients).toHaveLength(8);
    expect(data.deals).toHaveLength(10);
    expect(data.meetings).toHaveLength(8);
    expect(data.tasks.length).toBeGreaterThan(5);
    expect(data.integrations).toHaveLength(3);
    expect(data.templates).toHaveLength(2);
  });

  it('retrieves clients and preserves deal and meeting relations', async () => {
    const data = await repository.snapshot();
    const sever = data.clients.find(client => client.companyName === 'ООО Север');
    expect(sever?.name).toBe('Ирина Волкова');
    expect(data.deals.filter(deal => deal.clientId === sever?.id)).toHaveLength(2);
    expect(data.meetings.find(meeting => meeting.id === 'm1')?.clientId).toBe(sever?.id);
    expect(data.meetings.find(meeting => meeting.id === 'm1')?.dealId).toBe('d1');
  });

  it('persists task, profile and setting changes across reopening', async () => {
    await repository.setTaskCompleted('t1', true);
    await repository.updateProfile('Мария Тестовая');
    await repository.setSetting('notifications', 'off');
    repository.close();
    repository = create();
    await repository.initialize();
    const data = await repository.snapshot();
    expect(data.tasks.find(task => task.id === 't1')?.completed).toBe(true);
    expect(data.profile.displayName).toBe('Мария Тестовая');
    expect(data.settings.notifications).toBe('off');
    expect(data.clients).toHaveLength(8);
  });

  it('keeps the demo seed idempotent and reset restores it', async () => {
    repository.close(); repository = create(); await repository.initialize();
    expect((await repository.snapshot()).clients).toHaveLength(8);
    await repository.setTaskCompleted('t1', true);
    await repository.resetDemo();
    const data = await repository.snapshot();
    expect(data.clients).toHaveLength(8);
    expect(data.tasks.find(task => task.id === 't1')?.completed).toBe(false);
  });

  it('rejects invalid settings and unknown tasks', async () => {
    await expect(repository.setSetting('demo_seed_version', '2')).rejects.toThrow();
    await expect(repository.setTaskCompleted('missing', true)).rejects.toThrow();
  });
});
