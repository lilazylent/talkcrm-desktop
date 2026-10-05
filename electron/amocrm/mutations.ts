import type { CrmAccount, CrmRecord, CrmRelation } from '../../src/domain/crm.ts';
import type { CrmCommand, CrmEntityKind } from '../../src/domain/crmWrite.ts';
import type { SqliteRepository } from '../repository.ts';
import type { ScopedBatch } from '../crmPersistence.ts';
import { AmoClient } from './client.ts';
import { changeKeys, conflictingKeys, createdId, entityPayload } from './writes.ts';
import { CrmError, positiveId, record } from './security.ts';

const entityKind: Record<CrmEntityKind, string> = { leads: 'lead', contacts: 'contact', companies: 'company' };
const noteKind: Record<CrmEntityKind, string> = { leads: 'note', contacts: 'contact_note', companies: 'company_note' };
export interface MutationOutcome { resultId?: number; remoteUpdatedAt?: number|null; message: string }
const withEntity = (note: CrmRecord, entity: CrmEntityKind, entityId: number): CrmRecord => ({ ...note, entity_id: entityId, entity_type: entity });

/**
 * Executes one validated command: fresh read → conflict check → minimal write → re-read → cache reconciliation.
 * Only data returned by amoCRM ever reaches the cache.
 */
export async function performMutation(client: AmoClient, repository: SqliteRepository, account: CrmAccount, command: CrmCommand, startedAt: number): Promise<MutationOutcome> {
  switch (command.type) {
    case 'entity.update': {
      const kind = entityKind[command.entity]; const path = `/api/v4/${command.entity}/${command.entityId}`;
      const remote = { ...(await client.get(path)), id: command.entityId } as CrmRecord;
      if (command.entity === 'leads' && remote.responsible_user_id !== account.currentUserId) { await repository.putCrmEntity(kind, remote); throw new CrmError('write_403', 'Сделка передана другому ответственному. Изменение не сохранено.'); }
      const keys = changeKeys(command.changes);
      const conflicts = conflictingKeys(remote, command.baseUpdatedAt, keys, command.original);
      if (conflicts.length) { await repository.putCrmEntity(kind, remote); throw new CrmError('conflict', 'Карточка изменилась в amoCRM.'); }
      const body = entityPayload(repository.writeContext(), command.entity, remote, command.changes, command.confirmTerminal === true);
      await client.send('PATCH', path, body);
      const fresh = { ...(await client.get(path)), id: command.entityId } as CrmRecord;
      await repository.putCrmEntity(kind, fresh);
      return { remoteUpdatedAt: typeof fresh.updated_at === 'number' ? fresh.updated_at : null, message: 'Сохранено в amoCRM' };
    }
    case 'task.create': {
      const item: Record<string, unknown> = { text: command.text, complete_till: command.completeTill, entity_id: command.entityId, entity_type: command.entity, responsible_user_id: account.currentUserId, request_id: command.operationId };
      if (command.taskTypeId) item.task_type_id = command.taskTypeId;
      let id: number;
      try { id = createdId(await client.send('POST', '/api/v4/tasks', [item]), 'tasks', command.operationId); }
      catch (error) {
        if (!(error instanceof CrmError) || error.code !== 'ambiguous') throw error;
        const found = await findCreatedTask(client, command, startedAt); if (!found) throw new CrmError('needs_refresh', 'Не удалось подтвердить создание задачи. Обновите карточку перед повтором.');
        id = found;
      }
      const task = { ...(await client.get(`/api/v4/tasks/${id}`)), id } as CrmRecord; await repository.putCrmEntity('task', task);
      return { resultId: id, remoteUpdatedAt: Number(task.updated_at) || null, message: 'Задача создана в amoCRM' };
    }
    case 'task.update': case 'task.complete': {
      const path = `/api/v4/tasks/${command.taskId}`; const cached = repository.cachedEntity('task', command.taskId) ?? {} as CrmRecord;
      const remote = { ...(await client.get(path)), id: command.taskId } as CrmRecord;
      if (command.type === 'task.complete' && remote.is_completed === true) { await repository.putCrmEntity('task', remote); return { remoteUpdatedAt: Number(remote.updated_at) || null, message: 'Задача уже выполнена в amoCRM' }; }
      if (remote.is_completed === true) { await repository.putCrmEntity('task', remote); throw new CrmError('conflict', 'Задача уже была изменена в amoCRM.'); }
      const body: Record<string, unknown> = {};
      if (command.type === 'task.update') {
        if (command.baseUpdatedAt !== null && Number(remote.updated_at) !== command.baseUpdatedAt) {
          const changed = (key: string) => String(remote[key] ?? '') !== String(cached[key] ?? '');
          if ((command.text !== undefined && changed('text')) || (command.completeTill !== undefined && changed('complete_till')) || (command.taskTypeId !== undefined && changed('task_type_id'))) { await repository.putCrmEntity('task', remote); throw new CrmError('conflict', 'Задача уже была изменена в amoCRM.'); }
        }
        if (command.text !== undefined) body.text = command.text; if (command.completeTill !== undefined) body.complete_till = command.completeTill; if (command.taskTypeId) body.task_type_id = command.taskTypeId;
      } else { body.is_completed = true; if (command.result) body.result = { text: command.result }; }
      await client.send('PATCH', path, body);
      const fresh = { ...(await client.get(path)), id: command.taskId } as CrmRecord;
      if (command.type === 'task.complete' && fresh.is_completed !== true) { await repository.putCrmEntity('task', fresh); throw new CrmError('needs_refresh', 'amoCRM не подтвердила выполнение задачи. Обновите данные.'); }
      await repository.putCrmEntity('task', fresh);
      return { remoteUpdatedAt: Number(fresh.updated_at) || null, message: command.type === 'task.complete' ? 'Задача выполнена в amoCRM' : 'Задача сохранена в amoCRM' };
    }
    case 'note.create': {
      let id: number;
      try { id = createdId(await client.send('POST', `/api/v4/${command.entity}/notes`, [{ entity_id: command.entityId, note_type: 'common', params: { text: command.text }, request_id: command.operationId }]), 'notes', command.operationId); }
      catch (error) {
        if (!(error instanceof CrmError) || error.code !== 'ambiguous') throw error;
        const found = await findCreatedNote(client, command.entity, command.entityId, command.text, startedAt); if (!found) throw new CrmError('needs_refresh', 'Не удалось подтвердить сохранение примечания. Обновите карточку перед повтором.');
        id = found;
      }
      const note = withEntity({ ...(await client.get(`/api/v4/${command.entity}/notes/${id}`)), id } as CrmRecord, command.entity, command.entityId);
      await repository.putCrmEntity(noteKind[command.entity], note);
      return { resultId: id, message: 'Примечание добавлено в amoCRM' };
    }
    case 'note.update': {
      const path = `/api/v4/${command.entity}/notes/${command.noteId}`;
      const remote = record(await client.get(path)); if (remote.note_type !== 'common') throw new CrmError('write_403', 'Это примечание нельзя изменить в TalkCRM.');
      await client.send('PATCH', path, { note_type: 'common', params: { text: command.text } });
      const note = withEntity({ ...(await client.get(path)), id: command.noteId } as CrmRecord, command.entity, command.entityId);
      await repository.putCrmEntity(noteKind[command.entity], note);
      return { resultId: command.noteId, message: 'Примечание сохранено в amoCRM' };
    }
  }
}

/** After an ambiguous create, look for the exact task created during this operation instead of re-sending. */
async function findCreatedTask(client: AmoClient, command: Extract<CrmCommand, { type: 'task.create' }>, startedAt: number): Promise<number|null> {
  const tasks = await client.all('/api/v4/tasks', 'tasks', { 'filter[entity_type]': command.entity, 'filter[entity_id][0]': String(command.entityId), 'filter[is_completed]': '0' });
  return tasks.find(t => t.text === command.text && t.complete_till === command.completeTill && Number(t.created_at) >= startedAt - 120)?.id ?? null;
}
async function findCreatedNote(client: AmoClient, entity: CrmEntityKind, entityId: number, text: string, startedAt: number): Promise<number|null> {
  const notes = await client.all(`/api/v4/${entity}/${entityId}/notes`, 'notes');
  return notes.find(n => n.note_type === 'common' && record(n.params ?? {}).text === text && Number(n.created_at) >= startedAt - 120)?.id ?? null;
}

const ids = (list: number[], key = 'filter[id]') => Object.fromEntries(list.map((id, i) => [`${key}[${i}]`, String(id)]));
const chunks = <T,>(list: T[], size: number): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };

/** Scoped refresh of one workspace: its deals, contacts/companies, tasks and notes. */
export async function collectScoped(client: AmoClient, account: CrmAccount, scope: { leadIds: number[]; contactIds: number[]; companyIds: number[] }): Promise<ScopedBatch> {
  const batch: ScopedBatch = { leads: [], contacts: [], companies: [], tasks: [], notes: [], contactNotes: [], companyNotes: [], relations: [] };
  for (const part of chunks(scope.leadIds, 50)) batch.leads.push(...(await client.all('/api/v4/leads', 'leads', { with: 'contacts', ...ids(part) })).filter(l => part.includes(l.id) && l.responsible_user_id === account.currentUserId));
  const relations: CrmRelation[] = [];
  for (const lead of batch.leads) { const embedded = lead._embedded ? record(lead._embedded) : {}; for (const kind of ['contacts', 'companies'] as const) if (Array.isArray(embedded[kind])) for (const raw of embedded[kind]) { const entity = record(raw); relations.push({ leadId: lead.id, entityType: kind, entityId: positiveId(entity.id), primary: entity.is_main === true }); } }
  batch.relations = relations;
  const contactIds = [...new Set([...scope.contactIds, ...relations.filter(r => r.entityType === 'contacts').map(r => r.entityId)])];
  const companyIds = [...new Set([...scope.companyIds, ...relations.filter(r => r.entityType === 'companies').map(r => r.entityId)])];
  batch.contacts = await client.byIds('contacts', contactIds); batch.companies = await client.byIds('companies', companyIds);
  for (const [entity, list] of [['leads', batch.leads.map(l => l.id)], ['contacts', contactIds], ['companies', companyIds]] as const)
    for (const part of chunks(list, 10)) if (part.length) batch.tasks.push(...await client.all('/api/v4/tasks', 'tasks', { 'filter[entity_type]': entity, ...ids(part, 'filter[entity_id]') }));
  for (const lead of batch.leads) batch.notes.push(...(await client.all(`/api/v4/leads/${lead.id}/notes`, 'notes')).map(n => withEntity(n, 'leads', lead.id)));
  for (const id of contactIds) batch.contactNotes.push(...(await client.all(`/api/v4/contacts/${id}/notes`, 'notes')).map(n => withEntity(n, 'contacts', id)));
  for (const id of companyIds) batch.companyNotes.push(...(await client.all(`/api/v4/companies/${id}/notes`, 'notes')).map(n => withEntity(n, 'companies', id)));
  return batch;
}

/** History events for the workspace entities (amoCRM allows ten ids of one entity type per request). */
export async function collectEvents(client: AmoClient, entity: 'lead'|'contact'|'company', entityIds: number[]): Promise<Map<number, CrmRecord[]>> {
  const result = new Map<number, CrmRecord[]>(entityIds.map(id => [id, []]));
  for (const part of chunks(entityIds, 10)) {
    const events = await client.list('/api/v4/events', 'events', { 'filter[entity][0]': entity, ...ids(part, 'filter[entity_id]'), limit: '100' }, 5);
    for (const e of events) { const id = Number(e.entity_id); if (result.has(id)) result.get(id)!.push(e as CrmRecord); }
  }
  return result;
}
