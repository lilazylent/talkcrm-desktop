// Typed CRM mutation commands shared by renderer and main process.
// Every command is an explicit user action; future AI proposals must reuse these exact commands after human approval.
import type { CrmRecord } from './crm.ts';

export type CrmEntityKind = 'leads'|'contacts'|'companies';
export type FieldValue = { value?: string|number|boolean; enum_id?: number; enum_code?: string };
export interface FieldChange { fieldId: number; values: FieldValue[]|null }
export interface EntityChanges { name?: string; price?: number; pipelineId?: number; statusId?: number; fields?: FieldChange[] }
/** Values the user saw before editing, keyed like changes ('name', 'price', 'status', 'field:<id>'). */
export type OriginalValues = Record<string, unknown>;

export type CrmCommand =
  | { type: 'entity.update'; operationId: string; entity: CrmEntityKind; entityId: number; baseUpdatedAt: number|null; changes: EntityChanges; original: OriginalValues; confirmTerminal?: boolean }
  | { type: 'task.create'; operationId: string; entity: CrmEntityKind; entityId: number; text: string; completeTill: number; taskTypeId: number|null }
  | { type: 'task.update'; operationId: string; taskId: number; baseUpdatedAt: number|null; text?: string; completeTill?: number; taskTypeId?: number|null }
  | { type: 'task.complete'; operationId: string; taskId: number; baseUpdatedAt: number|null; result: string }
  | { type: 'note.create'; operationId: string; entity: CrmEntityKind; entityId: number; text: string }
  | { type: 'note.update'; operationId: string; entity: CrmEntityKind; entityId: number; noteId: number; text: string };

export type WriteStatus = 'pending'|'sending'|'confirmed'|'failed'|'needs_refresh'|'conflict';
export interface CrmWriteResult { ok: boolean; status: WriteStatus; message: string; operationId: string; resultId?: number }

export type TimelineSource = 'amo_event'|'amo_note'|'amo_task'|'kontur_meeting'|'talkcrm_local';
export type TimelineCategory = 'note'|'task'|'change'|'meeting'|'system';
export interface TimelineItem { id: string; source: TimelineSource; category: TimelineCategory; at: number; title: string; detail?: string; text?: string; dealId?: number|null; entity?: CrmEntityKind; entityId?: number; noteId?: number; editable?: boolean; meetingId?: string }
export interface TimelineData { events: CrmRecord[]; loadedAt: string|null; error: string|null }

export const TERMINAL_STATUSES = new Set([142, 143]);
export const EDITABLE_FIELD_TYPES = new Set(['text','textarea','numeric','checkbox','select','multiselect','radiobutton','date','date_time','birthday','url','multitext']);
export const MAX_TEXT = { name: 255, field: 4000, note: 20000, task: 4000, result: 2000 };
export const newOperationId = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const plain = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Normalized comparable value of an entity for one change key ('name', 'price', 'status', 'field:<id>'). Shared by UI and main process. */
export function comparable(entity: CrmRecord, key: string): string {
  if (key === 'name') return String(entity.name ?? '');
  if (key === 'price') return String(entity.price ?? 0);
  if (key === 'status') return `${entity.pipeline_id}:${entity.status_id}`;
  if (key.startsWith('field:')) {
    const id = Number(key.slice(6)); const values = Array.isArray(entity.custom_fields_values) ? entity.custom_fields_values : [];
    const field = values.map(plain).find(v => v.field_id === id);
    return (field && Array.isArray(field.values) ? field.values.map(v => { const r = plain(v); return `${r.enum_id ?? ''}|${r.enum_code ?? ''}|${r.value ?? ''}`; }) : []).join('§');
  }
  return '';
}
export const changeKeys = (changes: EntityChanges): string[] => [...(changes.name !== undefined ? ['name'] : []), ...(changes.price !== undefined ? ['price'] : []), ...(changes.statusId !== undefined ? ['status'] : []), ...(changes.fields ?? []).map(f => `field:${f.fieldId}`)];
