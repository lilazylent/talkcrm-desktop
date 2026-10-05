import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, CalendarDays, CheckSquare, Cog, MessageSquareText, Pencil, RefreshCw, StickyNote } from 'lucide-react';
import { useApp } from '../../App.tsx';
import { newOperationId, type CrmEntityKind, type TimelineCategory, type TimelineItem } from '../../domain/crmWrite.ts';
import { EmptyState, Modal, Notice, Segmented } from '../ui.tsx';
import { useCrmWrite } from './useCrmWrite.tsx';

export interface NoteTarget { entity: CrmEntityKind; entityId: number; label: string }
const icons: Record<TimelineCategory, typeof StickyNote> = { note: StickyNote, task: CheckSquare, change: ArrowRightLeft, meeting: CalendarDays, system: Cog };
const sourceLabel: Record<TimelineItem['source'], string> = { amo_event: 'amoCRM', amo_note: 'amoCRM', amo_task: 'amoCRM', kontur_meeting: 'Контур.Толк', talkcrm_local: 'TalkCRM' };
type Filter = 'all'|'note'|'task'|'change'|'meeting';
const when = (at: number) => at ? new Date(at * 1000).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: new Date(at * 1000).getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Дата неизвестна';
const dayTitle = (at: number) => { if (!at) return 'Без даты'; const d = new Date(at * 1000); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1); const same = (a: Date, b: Date) => a.toDateString() === b.toDateString(); return same(d, today) ? 'Сегодня' : same(d, y) ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }); };

/** Add a common note to the selected deal (or the contact when there is no deal). Ctrl+Enter submits. */
export function NoteComposer({ target, note, onClose }: { target: NoteTarget; note?: { id: number; text: string }; onClose: () => void }) {
  const [text, setText] = useState(note?.text ?? ''); const write = useCrmWrite();
  const submit = async () => { if (!text.trim()) return; const r = await write.run(note ? { type: 'note.update', operationId: newOperationId(), entity: target.entity, entityId: target.entityId, noteId: note.id, text } : { type: 'note.create', operationId: newOperationId(), entity: target.entity, entityId: target.entityId, text }); if (r?.ok) onClose(); };
  const keys = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } };
  return <Modal title={note ? 'Изменить примечание' : 'Новое примечание'} icon={StickyNote} onClose={() => { if (!write.saving) onClose(); }}>
    <p className="note-target">{target.entity === 'leads' ? 'Сделка' : target.entity === 'contacts' ? 'Контакт' : 'Компания'}: <strong>{target.label}</strong></p>
    <label className="field">Текст примечания<textarea className="input textarea" rows={6} autoFocus maxLength={20000} value={text} disabled={write.saving} onChange={e => setText(e.target.value)} onKeyDown={keys} placeholder="Что важно запомнить по клиенту"/></label>
    {write.state.status !== 'idle' && write.state.status !== 'saving' && write.state.status !== 'saved' && <Notice tone="danger" role="alert">{write.state.message}</Notice>}
    <div className="modal-actions split"><span className="muted small-copy"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> — {note ? 'сохранить' : 'добавить'}</span><span className="row"><button className="btn" disabled={write.saving} onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={write.saving || !text.trim()} onClick={() => void submit()}>{write.saving ? 'Сохраняем…' : note ? 'Сохранить' : 'Добавить'}</button></span></div>
  </Modal>;
}

export function TimelineFeed({ items, loading, error, loadedAt, onRefresh, dealLabel, onEditNote, limit, compact }: { items: TimelineItem[]; loading?: boolean; error?: string | null; loadedAt?: string | null; onRefresh?: () => void; dealLabel: (id: number | null | undefined) => string | null; onEditNote?: (item: TimelineItem) => void; limit?: number; compact?: boolean }) {
  const { canWrite } = useApp(); const [filter, setFilter] = useState<Filter>('all');
  const match = (i: TimelineItem) => filter === 'all' || i.category === filter || (filter === 'change' && i.category === 'system');
  const shown = items.filter(match).slice(0, limit ?? Infinity);
  const count = (f: Filter) => items.filter(i => f === 'all' || i.category === f || (f === 'change' && i.category === 'system')).length;
  let lastDay = '';
  return <div className="timeline-feed">
    {!compact && <div className="toolbar timeline-tools"><Segmented<Filter> label="Фильтр истории" value={filter} onChange={setFilter} options={[{ key: 'all', label: 'Все', count: count('all') }, { key: 'note', label: 'Примечания', count: count('note') }, { key: 'task', label: 'Задачи', count: count('task') }, { key: 'change', label: 'Изменения', count: count('change') }, { key: 'meeting', label: 'Встречи', count: count('meeting') }]}/><span className="spacer"/>{loadedAt && <span className="toolbar-note">История из amoCRM · {new Date(loadedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}{onRefresh && <button className="btn btn-sm" disabled={loading} onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''}/>Обновить</button>}</div>}
    {error && <Notice tone="warning" role="status">{error} Показаны примечания, задачи и встречи из кэша.</Notice>}
    {loading && !items.length ? <div className="transcript-loading" role="status"><span className="spinner"/>Загружаем историю amoCRM…</div>
      : shown.length ? <ol className="feed">{shown.map(item => { const Icon = icons[item.category]; const day = dayTitle(item.at); const header = !compact && day !== lastDay; lastDay = day; const deal = dealLabel(item.dealId);
        return <li key={item.id} className={`feed-item cat-${item.category}`}>{header && <div className="feed-day eyebrow">{day}</div>}<div className="feed-row"><span className="feed-icon"><Icon size={15}/></span><div className="grow"><div className="feed-head"><strong>{item.title}</strong><span className="feed-meta">{when(item.at)} · {sourceLabel[item.source]}{deal ? ` · ${deal}` : ''}</span></div>{item.detail && <p className="feed-detail">{item.detail}</p>}{item.text && <p className="feed-text">{item.text}</p>}{item.meetingId && <Link className="link-btn" to={`/meetings/${item.meetingId}`}>Открыть встречу</Link>}</div>{item.editable && onEditNote && <button className="icon-btn" aria-label="Изменить примечание" disabled={!canWrite} onClick={() => onEditNote(item)}><Pencil size={15}/></button>}</div></li>; })}</ol>
      : <EmptyState compact icon={MessageSquareText} title={filter === 'note' ? 'Примечаний пока нет.' : filter === 'meeting' ? 'Подтверждённых встреч пока нет.' : 'Событий пока нет.'}/>}
  </div>;
}
