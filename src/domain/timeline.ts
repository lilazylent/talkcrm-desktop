// amoCRM event → TalkCRM timeline item, plus composition of notes, tasks and confirmed meetings into one feed.
import type { CrmRecord } from './crm.ts';
import type { Meeting, Task } from './models.ts';
import type { CrmEntityKind, TimelineCategory, TimelineItem } from './crmWrite.ts';

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const first = (list: unknown): Record<string, unknown> => Array.isArray(list) && list.length ? obj(list[0]) : obj(list);
const entityKind: Record<string, CrmEntityKind> = { lead: 'leads', contact: 'contacts', company: 'companies' };
const short = (s: string, n = 120) => s.length > n ? s.slice(0, n - 1) + '…' : s;
const simple = (types: Record<string, [TimelineCategory, string]>) => types;
const named = simple({
  lead_added: ['system', 'Сделка создана'], lead_deleted: ['system', 'Сделка удалена'], lead_restored: ['system', 'Сделка восстановлена'],
  contact_added: ['system', 'Контакт создан'], contact_deleted: ['system', 'Контакт удалён'], contact_restored: ['system', 'Контакт восстановлен'],
  company_added: ['system', 'Компания создана'], company_deleted: ['system', 'Компания удалена'], company_restored: ['system', 'Компания восстановлена'],
  lead_linked: ['change', 'Сделка прикреплена'], lead_unlinked: ['change', 'Сделка откреплена'], contact_linked: ['change', 'Контакт прикреплён'], contact_unlinked: ['change', 'Контакт откреплён'],
  company_linked: ['change', 'Компания прикреплена'], company_unlinked: ['change', 'Компания откреплена'], entity_linked: ['change', 'Связь добавлена'], entity_unlinked: ['change', 'Связь удалена'],
  entity_merged: ['system', 'Записи объединены'], entity_tag_added: ['change', 'Добавлены теги'], entity_tag_deleted: ['change', 'Убраны теги'],
  task_added: ['task', 'Задача создана'], task_deleted: ['task', 'Задача удалена'], task_completed: ['task', 'Задача выполнена'], task_type_changed: ['task', 'Тип задачи изменён'],
  task_text_changed: ['task', 'Текст задачи изменён'], task_deadline_changed: ['task', 'Срок задачи изменён'], task_result_added: ['task', 'Добавлен результат задачи'],
  incoming_call: ['system', 'Входящий звонок'], outgoing_call: ['system', 'Исходящий звонок'], incoming_chat_message: ['system', 'Входящее сообщение в amoCRM'], outgoing_chat_message: ['system', 'Исходящее сообщение в amoCRM'],
  incoming_sms: ['system', 'Входящее SMS'], outgoing_sms: ['system', 'Исходящее SMS'], entity_direct_message: ['system', 'Сообщение во внутреннем чате'],
  common_note_added: ['note', 'Добавлено примечание'], common_note_deleted: ['note', 'Примечание удалено'], attachment_note_added: ['system', 'Добавлен файл'], service_note_added: ['system', 'Системное примечание'],
  geo_note_added: ['system', 'Примечание с геометкой'], site_visit_note_added: ['system', 'Заход на сайт'], key_action_completed: ['system', 'Ключевое действие'], transaction_added: ['system', 'Добавлена покупка'],
  nps_rate_added: ['system', 'Новая оценка NPS'], link_followed: ['system', 'Переход по ссылке'], robot_replied: ['system', 'Ответ робота'], intent_identified: ['system', 'Определена тема вопроса'],
  name_field_changed: ['change', 'Название изменено'], sale_field_changed: ['change', 'Бюджет изменён'], entity_responsible_changed: ['change', 'Ответственный изменён'], lead_status_changed: ['change', 'Этап сделки изменён'],
  ltv_field_changed: ['change', 'Изменена сумма покупок']
});

export interface TimelineLookup { pipelines: CrmRecord[]; fields: { entity: string; definition: CrmRecord }[] }
const stageName = (lookup: TimelineLookup, statusId: unknown, pipelineId: unknown): string => {
  if (statusId === 142) return 'Успешно реализовано'; if (statusId === 143) return 'Закрыто и не реализовано';
  const pipeline = lookup.pipelines.find(p => p.id === pipelineId) ?? lookup.pipelines.find(p => Array.isArray(obj(p._embedded).statuses) && (obj(p._embedded).statuses as unknown[]).some(s => obj(s).id === statusId));
  const status = Array.isArray(obj(pipeline?._embedded).statuses) ? (obj(pipeline!._embedded).statuses as unknown[]).map(obj).find(s => s.id === statusId) : undefined;
  return typeof status?.name === 'string' ? status.name : 'Неизвестный этап';
};
const fieldValueText = (v: Record<string, unknown>): string => { const cfv = obj(v.custom_field_value); const text = cfv.text ?? cfv.value; return typeof text === 'string' || typeof text === 'number' ? short(String(text), 60) : ''; };
const allFieldTexts = (list: unknown): string => Array.isArray(list) ? list.map(v => fieldValueText(obj(v))).filter(Boolean).join(', ') : '';

/** Normalizes one raw amoCRM event. Unknown types degrade to a neutral label; raw JSON is never exposed. */
export function normalizeEvent(event: CrmRecord, lookup: TimelineLookup): TimelineItem {
  const type = String(event.type ?? ''); const at = Number(event.created_at) || 0; const entity = entityKind[String(event.entity_type)];
  const base = { id: `event:${String(event.id)}`, source: 'amo_event' as const, at, entity, entityId: typeof event.entity_id === 'number' ? event.entity_id : undefined, dealId: event.entity_type === 'lead' && typeof event.entity_id === 'number' ? event.entity_id : null };
  const before = first(event.value_before); const after = first(event.value_after);
  const custom = /^custom_field_(\d+)_value_changed$/.exec(type);
  if (custom || type === 'custom_field_value_changed') {
    const fieldId = custom ? Number(custom[1]) : Number(obj(after.custom_field_value).field_id ?? obj(before.custom_field_value).field_id);
    const definition = lookup.fields.find(f => f.definition.id === fieldId)?.definition;
    const from = allFieldTexts(event.value_before), to = allFieldTexts(event.value_after);
    return { ...base, category: 'change', title: `Изменено поле «${typeof definition?.name === 'string' ? definition.name : 'Дополнительное поле'}»`, detail: from || to ? `${from || 'пусто'} → ${to || 'пусто'}` : undefined };
  }
  const known = named[type];
  if (!known) return { ...base, category: 'system', title: 'Изменение в amoCRM' };
  const [category, title] = known;
  let detail: string | undefined;
  if (type === 'lead_status_changed') { const b = obj(before.lead_status), a = obj(after.lead_status); detail = `${stageName(lookup, b.id, b.pipeline_id)} → ${stageName(lookup, a.id, a.pipeline_id)}`; }
  else if (type === 'sale_field_changed') { const b = obj(before.sale_field_value).sale, a = obj(after.sale_field_value).sale; if (b !== undefined || a !== undefined) detail = `${Number(b ?? 0).toLocaleString('ru-RU')} → ${Number(a ?? 0).toLocaleString('ru-RU')}`; }
  else if (type === 'name_field_changed') { const b = obj(before.name_field_value).name, a = obj(after.name_field_value).name; if (typeof a === 'string') detail = `${typeof b === 'string' ? short(b, 60) : '—'} → ${short(a, 60)}`; }
  else if (type === 'entity_responsible_changed') { const b = obj(before.responsible_user).id, a = obj(after.responsible_user).id; if (a !== undefined) detail = `${b ? `Пользователь #${b}` : '—'} → Пользователь #${a}`; }
  else if (type === 'task_text_changed') { const a = obj(after.task).text; if (typeof a === 'string') detail = short(a); }
  else if (type === 'task_deadline_changed') { const a = Number(obj(after.task_deadline).timestamp); if (a > 0) detail = `Новый срок: ${new Date(a * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`; }
  else if (type === 'task_result_added') { const r = obj(after.task_result ?? after.result).text ?? obj(after.note).text; if (typeof r === 'string') detail = short(r); }
  return { ...base, category, title, detail };
}

const NOTE_SYSTEM = new Set(['service_message', 'extended_service_message', 'lead_auto_created', 'message_cashier', 'geolocation', 'attachment', 'call_in', 'call_out', 'sms_in', 'sms_out']);
export const noteTextOf = (note: CrmRecord): string => { const p = obj(note.params); return typeof p.text === 'string' ? p.text : typeof note.text === 'string' ? note.text : ''; };
export function noteItem(note: CrmRecord, entity: CrmEntityKind, editable: boolean): TimelineItem {
  const type = String(note.note_type ?? 'common'); const system = type !== 'common';
  const label: Record<string, string> = { service_message: 'Системное сообщение', extended_service_message: 'Системное сообщение', lead_auto_created: 'Сделка создана автоматически', call_in: 'Входящий звонок', call_out: 'Исходящий звонок', sms_in: 'Входящее SMS', sms_out: 'Исходящее SMS', attachment: 'Файл', geolocation: 'Геометка' };
  const text = noteTextOf(note);
  return { id: `note:${entity}:${note.id}`, source: 'amo_note', category: system ? 'system' : 'note', at: Number(note.created_at) || 0, title: system ? (label[type] ?? 'Системная запись') : 'Примечание', text: text || undefined, entity, entityId: Number(note.entity_id) || undefined, dealId: entity === 'leads' ? Number(note.entity_id) : null, noteId: note.id, editable: !system && !NOTE_SYSTEM.has(type) && editable };
}
export function taskItems(task: Task & { taskTypeName?: string }): TimelineItem[] {
  const deal = task.dealId ? Number(task.dealId.split(':').pop()) : null; const created = Date.parse(task.createdAt) / 1000;
  const items: TimelineItem[] = [{ id: `task:${task.id}:created`, source: 'amo_task', category: 'task', at: created, title: 'Задача создана', detail: task.title, dealId: deal }];
  if (task.completed) items.push({ id: `task:${task.id}:done`, source: 'amo_task', category: 'task', at: Date.parse(task.updatedAt) / 1000 || created, title: 'Задача выполнена', detail: task.title, text: task.resultText ?? undefined, dealId: deal });
  return items;
}
export function meetingItem(meeting: Meeting): TimelineItem {
  return { id: `meeting:${meeting.id}`, source: 'kontur_meeting', category: 'meeting', at: Date.parse(meeting.startedAt) / 1000 || 0, title: 'Встреча в Контур.Толке', detail: meeting.title, meetingId: meeting.id, dealId: meeting.dealId ? Number(meeting.dealId.split(':').pop()) : null };
}

/**
 * Builds the feed. Notes and tasks come from their own caches (richer, and editable where allowed), so the matching
 * note/task events are skipped to avoid duplicates. Only confirmed meetings appear.
 */
export function composeTimeline(input: { events: CrmRecord[]; notes: { note: CrmRecord; entity: CrmEntityKind; editable: boolean }[]; tasks: (Task & { taskTypeName?: string })[]; meetings: Meeting[]; lookup: TimelineLookup }): TimelineItem[] {
  const noteIds = new Set(input.notes.map(n => n.note.id));
  const hasTasks = input.tasks.length > 0;
  const events = input.events.filter(e => {
    const type = String(e.type); const after = first(e.value_after);
    if (type === 'common_note_added' && noteIds.has(Number(obj(after.note).id))) return false;
    if (hasTasks && (type === 'task_added' || type === 'task_completed')) return false;
    return true;
  }).map(e => normalizeEvent(e, input.lookup));
  const items = [...events, ...input.notes.map(n => noteItem(n.note, n.entity, n.editable)), ...input.tasks.flatMap(taskItems), ...input.meetings.filter(m => m.crmLink?.confirmed).map(meetingItem)];
  const seen = new Set<string>();
  return items.filter(item => !seen.has(item.id) && seen.add(item.id)).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}
