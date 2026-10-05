// Browser-preview only: applies CRM commands to the synthetic preview snapshot so forms can be inspected visually.
// The installed application never uses this; real writes go through Electron IPC to amoCRM.
import type { AppSnapshot, Task } from '../domain/models.ts';
import type { CrmRecord } from '../domain/crm.ts';
import type { CrmCommand, CrmWriteResult } from '../domain/crmWrite.ts';
import { mapWorkspace } from '../../electron/amocrm/mapping.ts';

const now = () => Math.floor(Date.now() / 1000);
const taskRecord = (t: Task): CrmRecord => ({ id: Number(t.externalId), text: t.title, complete_till: t.dueAt ? Math.floor(Date.parse(t.dueAt) / 1000) : 0, is_completed: t.completed, entity_type: t.entityType ?? (t.dealId ? 'leads' : 'contacts'), entity_id: t.entityExternalId ?? Number(t.dealId?.split(':').pop()), responsible_user_id: 0, task_type_id: t.taskTypeId ?? 1, created_at: Math.floor(Date.parse(t.createdAt) / 1000), updated_at: t.remoteUpdatedAt ?? now(), ...(t.resultText ? { result: { text: t.resultText } } : {}) });

export function previewWrite(data: AppSnapshot, command: CrmCommand): { snapshot: AppSnapshot; result: CrmWriteResult } {
  const ok = (message: string, resultId?: number) => ({ ok: true, status: 'confirmed' as const, message, operationId: command.operationId, resultId });
  const crm = data.crm; const account = crm?.account;
  if (!crm || !account) return { snapshot: data, result: { ok: false, status: 'failed', message: 'Редактирование доступно после подключения amoCRM.', operationId: command.operationId } };
  if ('text' in command && typeof command.text === 'string' && command.text.includes('#403')) return { snapshot: data, result: { ok: false, status: 'failed', message: 'У вас нет прав на это изменение в amoCRM.', operationId: command.operationId } };
  const leads = [...(crm.leads ?? [])]; const contacts = [...crm.contacts]; const companies = [...crm.companies]; const notes = [...crm.notes]; const contactNotes = [...(crm.contactNotes ?? [])];
  let tasks: CrmRecord[] = data.tasks.filter(t => t.source === 'amocrm').map(t => ({ ...taskRecord(t), responsible_user_id: account.currentUserId }));
  const editable = [...(crm.editableNotes ?? [])]; let message = 'Сохранено в amoCRM'; let resultId: number | undefined;
  const patch = (list: CrmRecord[], id: number, apply: (r: CrmRecord) => CrmRecord) => { const i = list.findIndex(r => r.id === id); if (i >= 0) list[i] = { ...apply(list[i]), updated_at: now() }; };
  switch (command.type) {
    case 'entity.update': {
      const list = command.entity === 'leads' ? leads : command.entity === 'contacts' ? contacts : companies; const c = command.changes;
      patch(list, command.entityId, r => {
        const fields = Array.isArray(r.custom_fields_values) ? [...r.custom_fields_values as Record<string, unknown>[]] : [];
        for (const f of c.fields ?? []) { const i = fields.findIndex(x => x.field_id === f.fieldId); const def = crm.fields.find(d => d.definition.id === f.fieldId)?.definition; const item = { field_id: f.fieldId, field_name: def?.name, field_code: def?.code, values: f.values }; if (f.values === null) { if (i >= 0) fields.splice(i, 1); } else if (i >= 0) fields[i] = item; else fields.push(item); }
        return { ...r, ...(c.name !== undefined ? { name: c.name } : {}), ...(c.price !== undefined ? { price: c.price } : {}), ...(c.statusId !== undefined ? { status_id: c.statusId, pipeline_id: c.pipelineId ?? r.pipeline_id } : {}), custom_fields_values: fields };
      });
      break;
    }
    case 'task.create': resultId = Math.floor(Math.random() * 1e8); tasks = [...tasks, { id: resultId, text: command.text, complete_till: command.completeTill, is_completed: false, entity_type: command.entity, entity_id: command.entityId, responsible_user_id: account.currentUserId, task_type_id: command.taskTypeId ?? 1, created_at: now(), updated_at: now() }]; message = 'Задача создана в amoCRM'; break;
    case 'task.update': patch(tasks, command.taskId, t => ({ ...t, ...(command.text !== undefined ? { text: command.text } : {}), ...(command.completeTill !== undefined ? { complete_till: command.completeTill } : {}), ...(command.taskTypeId ? { task_type_id: command.taskTypeId } : {}) })); message = 'Задача сохранена в amoCRM'; break;
    case 'task.complete': patch(tasks, command.taskId, t => ({ ...t, is_completed: true, ...(command.result ? { result: { text: command.result } } : {}) })); message = 'Задача выполнена в amoCRM'; break;
    case 'note.create': { resultId = Math.floor(Math.random() * 1e8); const note = { id: resultId, note_type: 'common', params: { text: command.text }, entity_id: command.entityId, entity_type: command.entity, created_at: now(), updated_at: now() }; (command.entity === 'leads' ? notes : contactNotes).unshift(note); editable.push(`${command.entity}:${resultId}`); message = 'Примечание добавлено в amoCRM'; break; }
    case 'note.update': patch(command.entity === 'leads' ? notes : contactNotes, command.noteId, n => ({ ...n, params: { text: command.text } })); message = 'Примечание сохранено в amoCRM'; break;
  }
  const nextCrm = { ...crm, leads, contacts, companies, notes, contactNotes, editableNotes: editable };
  const mapped = mapWorkspace(account, leads.filter(l => l.responsible_user_id === account.currentUserId), nextCrm, crm.relations ?? [], tasks);
  return { snapshot: { ...data, crm: nextCrm, deals: mapped.deals, clients: mapped.clients, tasks: mapped.tasks }, result: ok(message, resultId) };
}
