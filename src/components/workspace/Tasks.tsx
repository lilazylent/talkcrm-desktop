import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarClock, Check, ListTodo, Pencil, Plus } from 'lucide-react';
import { useApp } from '../../App.tsx';
import type { Task } from '../../domain/models.ts';
import { formatDate } from '../../domain/models.ts';
import { newOperationId, type CrmEntityKind } from '../../domain/crmWrite.ts';
import { localToUnix, presetDue, taskBucket, taskTypes, unixToLocal, type TaskBucket } from '../../domain/workspace.ts';
import { Badge, EmptyState, Modal, Notice } from '../ui.tsx';
import { useCrmWrite } from './useCrmWrite.tsx';

export interface TaskTarget { entity: CrmEntityKind; entityId: number; label: string }
const bucketTitle: Record<TaskBucket, string> = { overdue: 'Просрочено', today: 'Сегодня', upcoming: 'Предстоящие', done: 'Выполнено' };
const bucketTone: Record<TaskBucket, string> = { overdue: 'danger', today: 'warning', upcoming: 'accent', done: 'success' };
const submitOnCtrlEnter = (submit: () => void) => (event: KeyboardEvent) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit(); } };

/** Create or edit an amoCRM task. Defaults: the selected deal, the current manager, a sensible due time. */
export function TaskForm({ task, targets, defaultTarget, onClose }: { task?: Task; targets: TaskTarget[]; defaultTarget?: number; onClose: () => void }) {
  const { data } = useApp(); const types = taskTypes(data.crm);
  const initial = task?.dueAt ? unixToLocal(Math.floor(Date.parse(task.dueAt) / 1000)) : presetDue('tomorrow');
  const [text, setText] = useState(task?.title ?? ''); const [date, setDate] = useState(initial.date); const [time, setTime] = useState(initial.time);
  const [type, setType] = useState(String(task?.taskTypeId ?? types[0]?.id ?? '')); const [target, setTarget] = useState(defaultTarget ?? 0); const [error, setError] = useState('');
  const write = useCrmWrite();
  const submit = async () => {
    setError(''); const due = localToUnix(date, time);
    if (!text.trim()) { setError('Напишите, что нужно сделать.'); return; } if (!Number.isFinite(due)) { setError('Укажите дату и время.'); return; }
    const result = task ? await write.run({ type: 'task.update', operationId: newOperationId(), taskId: Number(task.externalId), baseUpdatedAt: task.remoteUpdatedAt ?? null, ...(text.trim() !== task.title ? { text } : {}), ...(due !== Math.floor(Date.parse(task.dueAt ?? '') / 1000) ? { completeTill: due } : {}), ...(Number(type) !== (task.taskTypeId ?? 0) ? { taskTypeId: Number(type) || null } : {}) })
      : await write.run({ type: 'task.create', operationId: newOperationId(), entity: targets[target].entity, entityId: targets[target].entityId, text, completeTill: due, taskTypeId: Number(type) || null });
    if (result?.ok) onClose();
  };
  const presets = (['today', 'tomorrow', 'week'] as const).map(kind => ({ kind, label: { today: 'Сегодня', tomorrow: 'Завтра', week: 'Через неделю' }[kind], value: presetDue(kind) }));
  return <Modal title={task ? 'Изменить задачу' : 'Новая задача'} icon={ListTodo} onClose={() => { if (!write.saving) onClose(); }}>
    <form className="form-grid" onSubmit={e => { e.preventDefault(); void submit(); }} onKeyDown={submitOnCtrlEnter(() => void submit())}>
      <label className="field">Что сделать<textarea className="input textarea" rows={3} value={text} maxLength={4000} autoFocus disabled={write.saving} onChange={e => setText(e.target.value)} placeholder="Например: перезвонить и обсудить договор"/></label>
      <div className="field">Когда<div className="due-row"><input className="input" type="date" aria-label="Дата задачи" value={date} disabled={write.saving} onChange={e => setDate(e.target.value)}/><input className="input" type="time" aria-label="Время задачи" value={time} disabled={write.saving} onChange={e => setTime(e.target.value)}/></div>
        <div className="preset-row">{presets.map(p => <button type="button" key={p.kind} className={`chip-toggle${p.value.date === date && p.value.time === time ? ' on' : ''}`} onClick={() => { setDate(p.value.date); setTime(p.value.time); }}>{p.label}</button>)}</div></div>
      <label className="field">Тип<span className="select"><select value={type} disabled={write.saving} onChange={e => setType(e.target.value)}>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></span></label>
      {!task && (targets.length > 1 ? <label className="field">Привязать к<span className="select"><select value={target} disabled={write.saving} onChange={e => setTarget(Number(e.target.value))}>{targets.map((t, i) => <option key={`${t.entity}:${t.entityId}`} value={i}>{t.label}</option>)}</select></span></label> : targets[0] && <p className="muted small-copy">Задача появится в amoCRM у «{targets[0].label}». Ответственный — вы.</p>)}
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
      {write.state.status !== 'idle' && write.state.status !== 'saving' && write.state.status !== 'saved' && <Notice tone="danger" role="alert">{write.state.message}</Notice>}
      <div className="modal-actions split"><span className="muted small-copy"><kbd>Ctrl</kbd> + <kbd>Enter</kbd> — сохранить</span><span className="row"><button type="button" className="btn" disabled={write.saving} onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={write.saving || !targets.length && !task}>{write.saving ? 'Сохраняем…' : task ? 'Сохранить' : 'Создать задачу'}</button></span></div>
    </form>
  </Modal>;
}

/** Completion is written to amoCRM; the task turns completed only after amoCRM confirms it. */
export function CompleteTaskModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [result, setResult] = useState(''); const write = useCrmWrite();
  const submit = async () => { const r = await write.run({ type: 'task.complete', operationId: newOperationId(), taskId: Number(task.externalId), baseUpdatedAt: task.remoteUpdatedAt ?? null, result }); if (r?.ok) onClose(); };
  return <Modal title="Выполнить задачу" icon={Check} onClose={() => { if (!write.saving) onClose(); }}>
    <p className="task-quote">{task.title}</p>
    <label className="field">Результат <span className="hint">необязательно</span><textarea className="input textarea" rows={3} maxLength={2000} autoFocus value={result} disabled={write.saving} onChange={e => setResult(e.target.value)} onKeyDown={submitOnCtrlEnter(() => void submit())} placeholder="Например: договорились о встрече в пятницу"/></label>
    {write.state.status !== 'idle' && write.state.status !== 'saving' && write.state.status !== 'saved' && <Notice tone="danger" role="alert">{write.state.message}</Notice>}
    <div className="modal-actions"><button className="btn" disabled={write.saving} onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={write.saving} onClick={() => void submit()}>{write.saving ? 'Сохраняем…' : 'Выполнить'}</button></div>
  </Modal>;
}

/** One task row. amoCRM tasks are completed remotely; demo tasks stay local. Completed amoCRM tasks are read-only. */
export function TaskRow({ task, context, onEdit, onComplete, showClient }: { task: Task; context?: string; onEdit?: (task: Task) => void; onComplete: (task: Task) => void; showClient?: { id: string; label: string } }) {
  const { data, busy, mutate, canWrite, writeBlock } = useApp(); const remote = task.source === 'amocrm'; const bucket = taskBucket(task);
  const type = remote && task.taskTypeId ? taskTypes(data.crm).find(t => t.id === task.taskTypeId)?.name : undefined;
  return <div className={`task-row${task.completed ? ' done' : ''}`}>
    <label className="check-control"><input type="checkbox" aria-label={`Статус задачи: ${task.title}`} title={remote ? (task.completed ? 'Выполнена в amoCRM' : writeBlock ?? 'Выполнить в amoCRM') : undefined} checked={task.completed} disabled={busy || (remote && (task.completed || !canWrite))} onChange={event => { if (remote) { event.preventDefault(); onComplete(task); } else void mutate(api => api.setTaskCompleted(task.id, event.target.checked)); }}/><span/></label>
    <div className="grow"><strong>{task.title}</strong><small>{[type, context].filter(Boolean).join(' · ')}</small>{task.completed && task.resultText && <small className="task-result">Результат: {task.resultText}</small>}</div>
    <span className={`date-note${bucket === 'overdue' ? ' overdue' : bucket === 'today' ? ' today' : ''}`}><CalendarClock size={13}/>{formatDate(task.dueAt)}</span>
    {remote && !task.completed && onEdit && <button className="icon-btn" aria-label={`Изменить задачу: ${task.title}`} disabled={!canWrite} title={writeBlock ?? 'Изменить задачу'} onClick={() => onEdit(task)}><Pencil size={16}/></button>}
    {showClient && <Link className="icon-btn" to={`/clients/${showClient.id}`} aria-label={`Открыть ${showClient.label}`}><ArrowUpRight size={17}/></Link>}
  </div>;
}

export function TaskGroups({ tasks, contextOf, onAdd, onEdit, onComplete, emptyText }: { tasks: Task[]; contextOf: (task: Task) => string | undefined; onAdd?: () => void; onEdit: (task: Task) => void; onComplete: (task: Task) => void; emptyText: string }) {
  const { canWrite, writeBlock } = useApp();
  const buckets: TaskBucket[] = ['overdue', 'today', 'upcoming', 'done'];
  const by = (b: TaskBucket) => tasks.filter(t => taskBucket(t) === b).sort((x, y) => (x.dueAt ?? '9999').localeCompare(y.dueAt ?? '9999') * (b === 'done' ? -1 : 1));
  if (!tasks.length) return <div className="panel"><EmptyState icon={ListTodo} title={emptyText} action={onAdd && <button className="btn btn-primary" disabled={!canWrite} title={writeBlock ?? undefined} onClick={onAdd}><Plus size={16}/>Добавить задачу</button>}/></div>;
  return <div className="stack-lg">{buckets.map(b => { const list = by(b); if (!list.length && b !== 'today') return null; return <section key={b} className={`panel task-group ${bucketTone[b]}`}><div className="panel-head"><h2><span className={`group-dot ${bucketTone[b]}`}/>{bucketTitle[b]}</h2><span className="count" aria-hidden="true"><span>{list.length}</span></span>{b === 'done' && <Badge tone="neutral" small>Изменяются только в amoCRM</Badge>}</div><div className="task-list">{list.length ? list.map(t => <TaskRow key={t.id} task={t} context={contextOf(t)} onEdit={onEdit} onComplete={onComplete}/>) : <EmptyState compact icon={Check} title="На сегодня задач нет"/>}</div></section>; })}</div>;
}
