import { describe, expect, it } from 'vitest';
import { composeTimeline, normalizeEvent, noteItem } from '../src/domain/timeline.ts';
import { changeOf, displayValue, draftOf, fieldViews, importantFields, localToUnix, presetDue, taskBucket, unixToLocal } from '../src/domain/workspace.ts';
import type { CrmRecord } from '../src/domain/crm.ts';
import type { Meeting, Task } from '../src/domain/models.ts';

const lookup = { pipelines: [{ id: 5, name: 'Продажи', _embedded: { statuses: [{ id: 50, name: 'Переговоры' }, { id: 51, name: 'Согласование' }] } }], fields: [{ entity: 'leads', definition: { id: 201, name: 'Сотрудников', type: 'numeric' } }] };
const ev = (type: string, before: unknown[] = [], after: unknown[] = [], at = 1000): CrmRecord => ({ id: `e-${type}-${at}` as unknown as number, type, entity_type: 'lead', entity_id: 10, created_at: at, value_before: before, value_after: after });

describe('amoCRM event normalization', () => {
  it('maps stage, field, budget, responsible and task events to plain Russian', () => {
    expect(normalizeEvent(ev('lead_status_changed', [{ lead_status: { id: 50, pipeline_id: 5 } }], [{ lead_status: { id: 51, pipeline_id: 5 } }]), lookup)).toMatchObject({ category: 'change', title: 'Этап сделки изменён', detail: 'Переговоры → Согласование', source: 'amo_event', dealId: 10 });
    expect(normalizeEvent(ev('lead_status_changed', [{ lead_status: { id: 51, pipeline_id: 5 } }], [{ lead_status: { id: 142, pipeline_id: 5 } }]), lookup).detail).toBe('Согласование → Успешно реализовано');
    expect(normalizeEvent(ev('custom_field_201_value_changed', [{ custom_field_value: { field_id: 201, text: '15' } }], [{ custom_field_value: { field_id: 201, text: '25' } }]), lookup)).toMatchObject({ title: 'Изменено поле «Сотрудников»', detail: '15 → 25' });
    expect(normalizeEvent(ev('sale_field_changed', [{ sale_field_value: { sale: 1000 } }], [{ sale_field_value: { sale: 2500 } }]), lookup).detail).toBe(`${(1000).toLocaleString('ru-RU')} → ${(2500).toLocaleString('ru-RU')}`);
    expect(normalizeEvent(ev('entity_responsible_changed', [{ responsible_user: { id: 7 } }], [{ responsible_user: { id: 9 } }]), lookup)).toMatchObject({ title: 'Ответственный изменён', detail: 'Пользователь #7 → Пользователь #9' });
    expect(normalizeEvent(ev('task_completed'), lookup)).toMatchObject({ category: 'task', title: 'Задача выполнена' });
    expect(normalizeEvent(ev('common_note_added', [], [{ note: { id: 5 } }]), lookup)).toMatchObject({ category: 'note', title: 'Добавлено примечание' });
  });
  it('degrades unknown events gracefully and never exposes raw codes or JSON', () => {
    const item = normalizeEvent(ev('quantum_entanglement_detected', [{ secret: { a: 1 } }], [{ x: '{"raw":true}' }]), lookup);
    expect(item).toMatchObject({ category: 'system', title: 'Изменение в amoCRM' }); expect(`${item.title} ${item.detail ?? ""} ${item.text ?? ""}`).not.toMatch(/quantum|raw|secret/); expect(item.detail).toBeUndefined();
  });
  it('keeps system notes read-only and common notes editable only when TalkCRM created them', () => {
    expect(noteItem({ id: 1, note_type: 'service_message', params: { text: 'Робот' }, created_at: 1 }, 'leads', true)).toMatchObject({ category: 'system', editable: false });
    expect(noteItem({ id: 2, note_type: 'common', params: { text: 'Своё' }, created_at: 1 }, 'leads', true)).toMatchObject({ category: 'note', editable: true });
    expect(noteItem({ id: 3, note_type: 'common', params: { text: 'Чужое' }, created_at: 1 }, 'leads', false).editable).toBe(false);
  });
  it('orders the feed, preserves sources, de-duplicates notes and shows only confirmed meetings', () => {
    const task: Task = { id: 'amocrm:t:task:60', externalId: '60', source: 'amocrm', dealId: 'amocrm:t:lead:10', clientId: 'c', title: 'Позвонить', dueAt: null, completed: true, resultText: 'Готово', createdAt: new Date(2000 * 1000).toISOString(), updatedAt: new Date(4000 * 1000).toISOString() };
    const meeting = (id: string, confirmed: boolean): Meeting => ({ id, externalId: null, dealId: null, clientId: 'c', title: id, startedAt: new Date(3000 * 1000).toISOString(), durationSeconds: 60, participants: [], summary: null, transcript: [], recordingUrl: null, matchingStatus: 'linked', createdAt: '', updatedAt: '', source: 'kontur_talk', crmLink: confirmed ? { meetingId: id, status: 'confirmed', confirmed: { clientId: 'c' } as never, candidates: [], confirmedByUser: null, confirmedAt: null, matchMethod: null, updatedAt: '', warning: null } : undefined });
    const items = composeTimeline({ events: [ev('lead_added', [], [], 500), ev('common_note_added', [], [{ note: { id: 70 } }], 2500), ev('task_added', [], [], 2000)], notes: [{ note: { id: 70, note_type: 'common', params: { text: 'Текст' }, entity_id: 10, created_at: 2500 }, entity: 'leads', editable: false }], tasks: [task], meetings: [meeting('confirmed', true), meeting('proposed', false)], lookup });
    expect(items.map(i => i.title)).toEqual(['Задача выполнена', 'Встреча в Контур.Толке', 'Примечание', 'Задача создана', 'Сделка создана']);
    expect(items.map(i => i.source)).toEqual(['amo_task', 'kontur_meeting', 'amo_note', 'amo_task', 'amo_event']);
    expect(items.find(i => i.source === 'amo_task' && i.title === 'Задача выполнена')?.text).toBe('Готово');
  });
});

describe('workspace field and time helpers', () => {
  const defs = [{ entity: 'leads', definition: { id: 1, name: 'Источник', type: 'select', enums: [{ id: 5, value: 'Сайт' }] } }, { entity: 'leads', definition: { id: 2, name: 'Флаг', type: 'checkbox' } }, { entity: 'leads', definition: { id: 3, name: 'UTM', type: 'tracking_data' } }, { entity: 'leads', definition: { id: 4, name: 'Пустое', type: 'text' } }, { entity: 'leads', definition: { id: 6, name: 'Неизвестное', type: 'chained_list_v2' } }];
  const lead: CrmRecord = { id: 10, custom_fields_values: [{ field_id: 1, values: [{ enum_id: 5 }] }, { field_id: 2, values: [{ value: true }] }, { field_id: 3, values: [{ value: 'utm=1' }] }, { field_id: 6, values: [{ value: { deep: 1 } }] }] };
  it('renders enum names and booleans, puts filled fields first, keeps unknown types read-only', () => {
    const views = fieldViews({ fields: defs }, 'leads', lead);
    expect(views.find(v => v.id === 1)?.display).toBe('Сайт'); expect(views.find(v => v.id === 2)?.display).toBe('Да');
    expect(views.find(v => v.id === 6)).toMatchObject({ kind: 'readonly', display: '' }); expect(views.at(-1)?.filled).toBe(false);
    expect(importantFields(views).map(v => v.id)).toEqual([1, 2]);
    expect(importantFields(fieldViews({ fields: [{ entity: 'leads', definition: { id: 9, name: 'R_utm_source', type: 'text' } }, { entity: 'leads', definition: { id: 8, name: 'Сфера', type: 'text' } }] }, 'leads', { id: 1, custom_fields_values: [{ field_id: 9, values: [{ value: 'vk' }] }, { field_id: 8, values: [{ value: 'Спорт' }] }] })).map(v => v.name)).toEqual(['Сфера']);
    expect(displayValue(defs[0].definition as CrmRecord, [])).toBe('');
  });
  it('round-trips editor drafts into minimal changes', () => {
    const select = fieldViews({ fields: defs }, 'leads', lead).find(v => v.id === 1)!;
    expect(draftOf(select)).toBe('5'); expect(changeOf(select, '')).toEqual({ fieldId: 1, values: null }); expect(changeOf(select, '5')).toEqual({ fieldId: 1, values: [{ enum_id: 5 }] });
  });
  it('converts local wall-clock date/time to amoCRM seconds without timezone shifts', () => {
    const ts = localToUnix('2026-10-05', '18:30'); expect(ts).toBe(new Date(2026, 9, 5, 18, 30).getTime() / 1000);
    expect(unixToLocal(ts)).toEqual({ date: '2026-10-05', time: '18:30' });
    for (const [d, t] of [['2026-12-31', '23:59'], ['2027-01-01', '00:00'], ['2026-03-29', '02:30'], ['2026-02-28', '00:01']]) expect(unixToLocal(localToUnix(d, t))).toEqual({ date: d, time: t });
    expect(Number.isNaN(localToUnix('', '10:00'))).toBe(true);
    const now = new Date(2026, 9, 5, 23, 40); expect(presetDue('tomorrow', now)).toEqual({ date: '2026-10-06', time: '10:00' }); expect(presetDue('week', new Date(2026, 11, 28, 9))).toEqual({ date: '2027-01-04', time: '10:00' });
  });
  it('buckets tasks by local day', () => {
    const now = new Date(2026, 9, 5, 12, 0);
    expect(taskBucket({ completed: false, dueAt: new Date(2026, 9, 5, 9).toISOString() }, now)).toBe('today');
    expect(taskBucket({ completed: false, dueAt: new Date(2026, 9, 4, 23, 59).toISOString() }, now)).toBe('overdue');
    expect(taskBucket({ completed: false, dueAt: new Date(2026, 9, 6, 0, 1).toISOString() }, now)).toBe('upcoming');
    expect(taskBucket({ completed: true, dueAt: null }, now)).toBe('done');
  });
});
