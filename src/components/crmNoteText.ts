import type { CrmRecord } from '../domain/crm.ts';
// Short text of an amoCRM note for table cells; full notes are rendered by the workspace timeline.
export const noteText=(note:CrmRecord|undefined):string=>{const p=note?.params;if(p&&typeof p==='object'&&'text'in p&&typeof p.text==='string')return p.text;return typeof note?.text==='string'?note.text:note?`Примечание: ${String(note.note_type??'событие')}`:'—';};
