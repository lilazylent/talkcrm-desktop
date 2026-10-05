import type { CrmRecord } from '../../src/domain/crm.ts';
import { EDITABLE_FIELD_TYPES, MAX_TEXT, TERMINAL_STATUSES, comparable, changeKeys, type CrmCommand, type CrmEntityKind, type EntityChanges, type FieldChange, type FieldValue } from '../../src/domain/crmWrite.ts';
import { CrmError, record } from './security.ts';
export { comparable, changeKeys };

/** Metadata the validator needs; all of it comes from the synchronized amoCRM cache. */
export interface WriteContext {
  fields: { entity: string; definition: CrmRecord }[];
  pipelines: CrmRecord[];
  taskTypes: CrmRecord[];
  entity(kind: CrmEntityKind, id: number): CrmRecord | undefined;
  task(id: number): CrmRecord | undefined;
  noteEditable(entity: CrmEntityKind, noteId: number): boolean;
}
const invalid = (message: string) => new CrmError('input', message);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const kinds = new Set<CrmEntityKind>(['leads','contacts','companies']);
const cleanText = (value: unknown, max: number, label: string, allowEmpty = false): string => {
  if (typeof value !== 'string') throw invalid(`Заполните поле «${label}».`);
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!allowEmpty && !text) throw invalid(`Заполните поле «${label}».`);
  if (text.length > max) throw invalid(`Поле «${label}» слишком длинное.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw invalid(`Поле «${label}» содержит недопустимые символы.`);
  return text;
};
const statuses = (pipeline: CrmRecord): CrmRecord[] => { const e = pipeline._embedded ? record(pipeline._embedded) : {}; return Array.isArray(e.statuses) ? e.statuses.map(s => record(s) as CrmRecord) : []; };
export const fieldDefinition = (ctx: WriteContext, entity: CrmEntityKind, id: number) => ctx.fields.find(f => f.entity === entity && f.definition.id === id)?.definition;
export const fieldEditable = (definition: CrmRecord | undefined): boolean => !!definition && EDITABLE_FIELD_TYPES.has(String(definition.type)) && definition.is_computed !== true;
const enums = (definition: CrmRecord): CrmRecord[] => Array.isArray(definition.enums) ? definition.enums.map(e => record(e) as CrmRecord) : [];

/** Validates one field change against its synchronized definition and returns the exact amoCRM payload item. */
export function fieldPayload(definition: CrmRecord | undefined, change: FieldChange): Record<string, unknown> {
  if (!definition || !fieldEditable(definition)) throw invalid('Это поле пока можно изменить только в amoCRM.');
  const name = String(definition.name ?? 'Поле'); const type = String(definition.type);
  if (change.values === null || (Array.isArray(change.values) && change.values.length === 0)) return { field_id: definition.id, values: null };
  if (!Array.isArray(change.values) || change.values.length > 20) throw invalid(`Некорректное значение поля «${name}».`);
  const known = enums(definition); const enumIds = new Set(known.map(e => e.id)); const enumCodes = new Set(known.map(e => String(e.value ?? e.enum_code ?? '')));
  const one = (v: FieldValue): Record<string, unknown> => {
    if (!v || typeof v !== 'object') throw invalid(`Некорректное значение поля «${name}».`);
    switch (type) {
      case 'text': case 'textarea': return { value: cleanText(v.value, MAX_TEXT.field, name) };
      case 'url': { const value = cleanText(v.value, 2000, name); let url: URL; try { url = new URL(value); } catch { throw invalid(`Укажите адрес в поле «${name}» полностью, например https://site.ru.`); } if (!['http:','https:'].includes(url.protocol)) throw invalid(`Поле «${name}» принимает только http(s)-адрес.`); return { value }; }
      case 'numeric': { const raw = typeof v.value === 'string' ? v.value.replace(/\s/g, '').replace(',', '.') : v.value; const n = typeof raw === 'number' ? raw : Number(raw); if (raw === '' || !Number.isFinite(n) || Math.abs(n) > 1e15) throw invalid(`В поле «${name}» нужно число.`); return { value: String(n) }; }
      case 'checkbox': if (typeof v.value !== 'boolean') throw invalid(`Некорректное значение поля «${name}».`); return { value: v.value };
      case 'select': case 'radiobutton': case 'multiselect': if (!isId(v.enum_id) || !enumIds.has(v.enum_id)) throw invalid(`Выберите значение поля «${name}» из списка amoCRM.`); return { enum_id: v.enum_id };
      case 'date': case 'date_time': case 'birthday': { const n = Number(v.value); if (!Number.isSafeInteger(n) || n < -2208988800 || n > 4102444800) throw invalid(`Укажите корректную дату в поле «${name}».`); return { value: n }; }
      case 'multitext': {
        const value = cleanText(v.value, 255, name); const code = v.enum_code;
        if (code !== undefined && (typeof code !== 'string' || (enumCodes.size && !enumCodes.has(code)))) throw invalid(`Некорректный тип значения в поле «${name}».`);
        if (definition.code === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw invalid('Проверьте адрес почты.');
        if (definition.code === 'PHONE' && !/^[\d\s+().-]{5,32}$/.test(value)) throw invalid('Проверьте номер телефона.');
        return code ? { value, enum_code: code } : { value };
      }
    }
    throw invalid('Это поле пока можно изменить только в amoCRM.');
  };
  if (!['multiselect','multitext'].includes(type) && change.values.length > 1) throw invalid(`Поле «${name}» принимает одно значение.`);
  return { field_id: definition.id, values: change.values.map(one) };
}

/** Builds a PATCH body containing only the fields the user changed. */
export function entityPayload(ctx: WriteContext, entity: CrmEntityKind, current: CrmRecord, changes: EntityChanges, confirmTerminal: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {}; const keys = Object.keys(changes ?? {});
  if (!keys.length) throw invalid('Нет изменений для сохранения.');
  for (const key of keys) if (!['name','price','pipelineId','statusId','fields'].includes(key)) throw invalid('Некорректное изменение.');
  if (changes.name !== undefined) body.name = cleanText(changes.name, MAX_TEXT.name, entity === 'leads' ? 'Название сделки' : 'Имя');
  if (entity === 'leads') {
    if (changes.price !== undefined) { if (typeof changes.price !== 'number' || !Number.isSafeInteger(changes.price) || changes.price < 0 || changes.price > 1e13) throw invalid('Бюджет должен быть целым неотрицательным числом.'); body.price = changes.price; }
    if (changes.statusId !== undefined || changes.pipelineId !== undefined) {
      const statusId = changes.statusId; const pipelineId = changes.pipelineId ?? Number(current.pipeline_id);
      if (!isId(statusId)) throw invalid('Выберите этап сделки.');
      const pipeline = ctx.pipelines.find(p => p.id === pipelineId); if (!pipeline) throw invalid('Воронка недоступна. Обновите данные amoCRM.');
      if (!statuses(pipeline).some(s => s.id === statusId)) throw invalid('Этап не относится к выбранной воронке.');
      const terminalMove = TERMINAL_STATUSES.has(statusId) || TERMINAL_STATUSES.has(Number(current.status_id));
      if (terminalMove && statusId !== Number(current.status_id) && !confirmTerminal) throw new CrmError('confirm', 'Подтвердите перевод сделки.');
      body.status_id = statusId; if (pipelineId !== Number(current.pipeline_id)) body.pipeline_id = pipelineId;
    }
  } else if (changes.price !== undefined || changes.statusId !== undefined || changes.pipelineId !== undefined) throw invalid('Некорректное изменение.');
  if (changes.fields !== undefined) {
    if (!Array.isArray(changes.fields) || changes.fields.length > 100) throw invalid('Некорректное изменение полей.');
    const ids = new Set<number>();
    body.custom_fields_values = changes.fields.map(change => { if (!isId(change?.fieldId) || ids.has(change.fieldId)) throw invalid('Некорректное поле.'); ids.add(change.fieldId); return fieldPayload(fieldDefinition(ctx, entity, change.fieldId), change); });
  }
  return body;
}

/**
 * Conflict rule: if the remote entity moved since the user loaded it, every edited key must still hold the
 * value the user saw. Independent remote changes to other keys are safe because only changed keys are sent.
 */
export function conflictingKeys(remote: CrmRecord, baseUpdatedAt: number | null, keys: string[], original: Record<string, unknown>): string[] {
  if (baseUpdatedAt !== null && Number(remote.updated_at) === baseUpdatedAt) return [];
  return keys.filter(key => !(key in original) || String(original[key]) !== comparable(remote, key));
}

export function validateCommand(value: unknown, ctx: WriteContext): CrmCommand {
  const c = record(value) as Record<string, unknown>;
  if (typeof c.operationId !== 'string' || !/^[\w-]{8,64}$/.test(c.operationId)) throw invalid('Некорректная операция.');
  const entity = c.entity as CrmEntityKind;
  const needEntity = () => { if (!kinds.has(entity) || !isId(c.entityId) || !ctx.entity(entity, c.entityId)) throw invalid('Запись не найдена в кэше. Обновите данные amoCRM.'); };
  const base = (): number | null => c.baseUpdatedAt === null || c.baseUpdatedAt === undefined ? null : Number.isSafeInteger(c.baseUpdatedAt) ? Number(c.baseUpdatedAt) : (() => { throw invalid('Некорректная версия записи.'); })();
  const due = (v: unknown): number => { if (!Number.isSafeInteger(v) || Number(v) < 946684800 || Number(v) > 4102444800) throw invalid('Укажите корректные дату и время.'); return Number(v); };
  const taskType = (v: unknown): number | null => { if (v === null || v === undefined) return null; if (!isId(v) || (ctx.taskTypes.length && !ctx.taskTypes.some(t => t.id === v))) throw invalid('Выберите тип задачи из списка amoCRM.'); return v; };
  switch (c.type) {
    case 'entity.update': { needEntity(); if (!c.changes || typeof c.changes !== 'object' || !c.original || typeof c.original !== 'object') throw invalid('Нет изменений для сохранения.');
      const target = (c.changes as EntityChanges).statusId; const current = Number(ctx.entity(entity, c.entityId as number)?.status_id);
      // A move into or out of a closed stage needs explicit confirmation before anything is sent.
      if (entity === 'leads' && target !== undefined && target !== current && (TERMINAL_STATUSES.has(Number(target)) || TERMINAL_STATUSES.has(current)) && c.confirmTerminal !== true) throw new CrmError('confirm', 'Подтвердите перевод сделки.');
      return { type: 'entity.update', operationId: c.operationId, entity, entityId: c.entityId as number, baseUpdatedAt: base(), changes: c.changes as EntityChanges, original: c.original as Record<string, unknown>, confirmTerminal: c.confirmTerminal === true }; }
    case 'task.create': needEntity(); return { type: 'task.create', operationId: c.operationId, entity, entityId: c.entityId as number, text: cleanText(c.text, MAX_TEXT.task, 'Что сделать'), completeTill: due(c.completeTill), taskTypeId: taskType(c.taskTypeId) };
    case 'task.update': { if (!isId(c.taskId) || !ctx.task(c.taskId)) throw invalid('Задача не найдена. Обновите данные amoCRM.'); if (ctx.task(c.taskId)!.is_completed === true) throw invalid('Выполненную задачу нельзя изменить.'); const cmd: CrmCommand = { type: 'task.update', operationId: c.operationId, taskId: c.taskId, baseUpdatedAt: base() }; if (c.text !== undefined) cmd.text = cleanText(c.text, MAX_TEXT.task, 'Что сделать'); if (c.completeTill !== undefined) cmd.completeTill = due(c.completeTill); if (c.taskTypeId !== undefined) cmd.taskTypeId = taskType(c.taskTypeId); if (cmd.text === undefined && cmd.completeTill === undefined && cmd.taskTypeId === undefined) throw invalid('Нет изменений для сохранения.'); return cmd; }
    case 'task.complete': if (!isId(c.taskId) || !ctx.task(c.taskId)) throw invalid('Задача не найдена. Обновите данные amoCRM.'); if (ctx.task(c.taskId)!.is_completed === true) throw invalid('Задача уже выполнена.'); return { type: 'task.complete', operationId: c.operationId, taskId: c.taskId, baseUpdatedAt: base(), result: cleanText(c.result ?? '', MAX_TEXT.result, 'Результат', true) };
    case 'note.create': needEntity(); return { type: 'note.create', operationId: c.operationId, entity, entityId: c.entityId as number, text: cleanText(c.text, MAX_TEXT.note, 'Примечание') };
    case 'note.update': needEntity(); if (!isId(c.noteId) || !ctx.noteEditable(entity, c.noteId)) throw invalid('Это примечание нельзя изменить в TalkCRM.'); return { type: 'note.update', operationId: c.operationId, entity, entityId: c.entityId as number, noteId: c.noteId, text: cleanText(c.text, MAX_TEXT.note, 'Примечание') };
  }
  throw invalid('Неизвестная операция.');
}

/** Extracts the created id (and verifies the echoed request_id) from an amoCRM batch create response. */
export function createdId(dto: Record<string, unknown>, kind: 'tasks'|'notes', requestId: string): number {
  const embedded = dto._embedded ? record(dto._embedded) : {}; const items = embedded[kind];
  if (!Array.isArray(items) || items.length !== 1) throw new CrmError('ambiguous', 'amoCRM не вернула созданную запись. Проверяем результат.');
  const item = record(items[0]); if (item.request_id !== undefined && String(item.request_id) !== requestId) throw new CrmError('ambiguous', 'amoCRM вернула чужую запись. Проверяем результат.');
  if (!isId(item.id)) throw new CrmError('ambiguous', 'amoCRM не вернула идентификатор записи.');
  return item.id;
}
export const fingerprint = (command: CrmCommand): string => {
  const { operationId: _ignored, ...rest } = command; void _ignored; return JSON.stringify(rest);
};
