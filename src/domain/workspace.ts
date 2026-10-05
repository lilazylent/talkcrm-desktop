// Pure helpers for the client workspace: field display/editing, multi-value phone/email, and local date conversion.
import type { CrmCache, CrmRecord } from './crm.ts';
import { EDITABLE_FIELD_TYPES, type CrmEntityKind, type FieldChange, type FieldValue } from './crmWrite.ts';

const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export type EditorKind = 'text'|'textarea'|'number'|'checkbox'|'select'|'multiselect'|'date'|'datetime'|'url'|'multitext'|'readonly';
export interface FieldView { id: number; name: string; type: string; code: string|null; kind: EditorKind; enums: { id: number; value: string }[]; groupId: string|null; sort: number; values: FieldValue[]; display: string; filled: boolean }

export const editorKind = (def: CrmRecord): EditorKind => {
  const type = String(def.type);
  if (!EDITABLE_FIELD_TYPES.has(type) || def.is_computed === true) return 'readonly';
  return ({ text: 'text', textarea: 'textarea', numeric: 'number', checkbox: 'checkbox', select: 'select', radiobutton: 'select', multiselect: 'multiselect', date: 'date', birthday: 'date', date_time: 'datetime', url: 'url', multitext: 'multitext' } as Record<string, EditorKind>)[type] ?? 'readonly';
};
export const fieldValues = (entity: CrmRecord | undefined, fieldId: number): FieldValue[] => {
  const list = Array.isArray(entity?.custom_fields_values) ? entity!.custom_fields_values : [];
  const field = list.map(obj).find(f => f.field_id === fieldId);
  return Array.isArray(field?.values) ? field!.values.map(v => { const r = obj(v); return { ...(r.value !== undefined && r.value !== null ? { value: r.value as string|number|boolean } : {}), ...(typeof r.enum_id === 'number' ? { enum_id: r.enum_id } : {}), ...(typeof r.enum_code === 'string' ? { enum_code: r.enum_code } : {}) }; }) : [];
};
const enumsOf = (def: CrmRecord) => Array.isArray(def.enums) ? def.enums.map(obj).filter(e => typeof e.id === 'number').map(e => ({ id: e.id as number, value: String(e.value ?? '') })) : [];
export const MULTITEXT_LABEL: Record<string, string> = { WORK: 'Рабочий', WORKDD: 'Рабочий прямой', MOB: 'Мобильный', FAX: 'Факс', HOME: 'Домашний', OTHER: 'Другой', PRIV: 'Личный' };
const dateText = (v: unknown, withTime: boolean): string => { const n = Number(v); if (!Number.isFinite(n) || n === 0) return String(v ?? ''); return new Date(n * 1000).toLocaleString('ru-RU', withTime ? { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'long', year: 'numeric' }); };

/** Human-readable value; never raw JSON. */
export function displayValue(def: CrmRecord, values: FieldValue[]): string {
  if (!values.length) return '';
  const type = String(def.type); const enums = enumsOf(def);
  const one = (v: FieldValue): string => {
    if (['select','radiobutton','multiselect'].includes(type)) return enums.find(e => e.id === v.enum_id)?.value ?? (typeof v.value === 'string' ? v.value : '');
    if (type === 'checkbox') return v.value === true || v.value === 1 || v.value === '1' ? 'Да' : 'Нет';
    if (type === 'date' || type === 'birthday') return dateText(v.value, false);
    if (type === 'date_time') return dateText(v.value, true);
    if (type === 'multitext') return `${String(v.value ?? '')}${v.enum_code && MULTITEXT_LABEL[v.enum_code] ? ` · ${MULTITEXT_LABEL[v.enum_code]}` : ''}`;
    if (v.value !== undefined && typeof v.value !== 'object') return String(v.value);
    return '';
  };
  return values.map(one).filter(Boolean).join(', ');
}

export function fieldViews(cache: Pick<CrmCache, 'fields'>, entity: CrmEntityKind, record: CrmRecord | undefined): FieldView[] {
  return cache.fields.filter(f => f.entity === entity).map(({ definition: def }) => {
    const values = fieldValues(record, def.id); const display = displayValue(def, values);
    return { id: def.id, name: String(def.name ?? `Поле ${def.id}`), type: String(def.type), code: typeof def.code === 'string' ? def.code : null, kind: editorKind(def), enums: enumsOf(def), groupId: typeof def.group_id === 'string' ? def.group_id : null, sort: Number(def.sort ?? 0), values, display, filled: display.trim().length > 0 };
  }).sort((a, b) => Number(b.filled) - Number(a.filled) || Number(technicalField(a)) - Number(technicalField(b)) || a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
}

/** Fields worth showing first: populated, editable-or-meaningful, not technical tracking data. */
/** Marketing/technical attribution fields (UTM, click ids, form ids) are kept but not promoted. */
export const technicalField = (view: Pick<FieldView, 'name'|'type'>): boolean => ['tracking_data','file'].includes(view.type) || /utm|roistat|gclid|yclid|fbclid|ym_?uid|ymclid|(^|_)ga_|referr|tranid|form_?id|formname|client_?id|openstat|from_url|landing/i.test(view.name);
export const importantFields = (views: FieldView[], limit = 6): FieldView[] => views.filter(v => v.filled && !technicalField(v) && v.code !== 'PHONE' && v.code !== 'EMAIL').slice(0, limit);

// ---- Editor drafts ----
export type Draft = string | boolean | number[] | { value: string; enum_code: string }[];
export function draftOf(view: FieldView): Draft {
  const v = view.values;
  switch (view.kind) {
    case 'checkbox': return v[0]?.value === true || v[0]?.value === 1;
    case 'select': return v[0]?.enum_id ? String(v[0].enum_id) : '';
    case 'multiselect': return v.map(x => x.enum_id).filter((x): x is number => typeof x === 'number');
    case 'date': return v[0]?.value ? unixToLocal(Number(v[0].value)).date : '';
    case 'datetime': { if (!v[0]?.value) return ''; const l = unixToLocal(Number(v[0].value)); return `${l.date}T${l.time}`; }
    case 'multitext': return v.map(x => ({ value: String(x.value ?? ''), enum_code: x.enum_code ?? '' }));
    default: return v[0]?.value !== undefined ? String(v[0].value) : '';
  }
}
/** Converts an editor draft into the change sent to the main process (which validates it again). */
export function changeOf(view: FieldView, draft: Draft): FieldChange {
  const empty = { fieldId: view.id, values: null };
  switch (view.kind) {
    case 'checkbox': return { fieldId: view.id, values: [{ value: draft === true }] };
    case 'select': return draft ? { fieldId: view.id, values: [{ enum_id: Number(draft) }] } : empty;
    case 'multiselect': return (draft as number[]).length ? { fieldId: view.id, values: (draft as number[]).map(id => ({ enum_id: id })) } : empty;
    case 'date': return draft ? { fieldId: view.id, values: [{ value: localToUnix(String(draft), '00:00') }] } : empty;
    case 'datetime': { if (!draft) return empty; const [d, t] = String(draft).split('T'); return { fieldId: view.id, values: [{ value: localToUnix(d, t ?? '00:00') }] }; }
    case 'multitext': { const rows = (draft as { value: string; enum_code: string }[]).filter(r => r.value.trim()); return rows.length ? { fieldId: view.id, values: rows.map(r => ({ value: r.value.trim(), ...(r.enum_code ? { enum_code: r.enum_code } : {}) })) } : empty; }
    default: return String(draft).trim() ? { fieldId: view.id, values: [{ value: String(draft).trim() }] } : empty;
  }
}
export const sameDraft = (a: Draft, b: Draft): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---- Local date/time ↔ amoCRM unix seconds (no UTC shifting: the user's wall clock is authoritative) ----
const pad = (n: number) => String(n).padStart(2, '0');
export function localToUnix(date: string, time = '00:00'): number {
  const [y, m, d] = date.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return NaN;
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0, 0).getTime() / 1000);
}
export function unixToLocal(seconds: number): { date: string; time: string } {
  const d = new Date(seconds * 1000); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
/** Quick due-date presets for the task form. */
export function presetDue(kind: 'today'|'tomorrow'|'week', now = new Date()): { date: string; time: string } {
  const d = new Date(now); if (kind === 'tomorrow') d.setDate(d.getDate() + 1); if (kind === 'week') d.setDate(d.getDate() + 7);
  const hour = kind === 'today' ? Math.min(23, Math.max(now.getHours() + 1, 10)) : 10;
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(hour)}:00` };
}

export const TASK_TYPE_FALLBACK = [{ id: 1, name: 'Звонок' }, { id: 2, name: 'Встреча' }];
export const taskTypes = (cache?: Pick<CrmCache, 'taskTypes'>): { id: number; name: string }[] => {
  const list = (cache?.taskTypes ?? []).filter(t => typeof t.id === 'number').map(t => ({ id: t.id, name: String(t.name ?? `Тип ${t.id}`) }));
  return list.length ? list : TASK_TYPE_FALLBACK;
};
export type TaskBucket = 'overdue'|'today'|'upcoming'|'done';
export function taskBucket(task: { completed: boolean; dueAt: string | null }, now = new Date()): TaskBucket {
  if (task.completed) return 'done'; if (!task.dueAt) return 'upcoming';
  const due = new Date(task.dueAt); const sameDay = due.getFullYear() === now.getFullYear() && due.getMonth() === now.getMonth() && due.getDate() === now.getDate();
  if (sameDay) return 'today'; return due < now ? 'overdue' : 'upcoming';
}
