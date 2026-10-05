import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Lock } from 'lucide-react';
import { useApp } from '../../App.tsx';
import type { CrmRecord } from '../../domain/crm.ts';
import { comparable, newOperationId, TERMINAL_STATUSES } from '../../domain/crmWrite.ts';
import { Modal, StageBadge } from '../ui.tsx';
import { SaveIndicator, useCrmWrite } from './useCrmWrite.tsx';

interface Stage { id: number; name: string; sort: number; color: string | null; type: number }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const pipelineStages = (pipeline: CrmRecord | undefined): Stage[] => (Array.isArray(obj(pipeline?._embedded).statuses) ? (obj(pipeline!._embedded).statuses as unknown[]).map(obj) : [])
  .filter(s => typeof s.id === 'number').map(s => ({ id: s.id as number, name: s.id === 142 ? 'Успешно реализовано' : s.id === 143 ? 'Закрыто и не реализовано' : String(s.name ?? `Этап ${s.id}`), sort: Number(s.sort ?? 0), color: typeof s.color === 'string' ? s.color : null, type: Number(s.type ?? 0) }))
  .sort((a, b) => (TERMINAL_STATUSES.has(a.id) ? 1 : 0) - (TERMINAL_STATUSES.has(b.id) ? 1 : 0) || a.sort - b.sort);

/** Current stage with a simple chooser. Only existing amoCRM stages of a real pipeline can be selected. */
export function StageControl({ lead, onRefresh }: { lead: CrmRecord; onRefresh: () => Promise<void> }) {
  const { data, canWrite, writeBlock } = useApp();
  const pipelines = data.crm?.pipelines ?? [];
  const [open, setOpen] = useState(false); const [pipelineId, setPipelineId] = useState(Number(lead.pipeline_id)); const [confirm, setConfirm] = useState<Stage | null>(null);
  const write = useCrmWrite(); const box = useRef<HTMLDivElement>(null);
  const currentPipeline = pipelines.find(p => p.id === Number(lead.pipeline_id)); const current = pipelineStages(currentPipeline).find(s => s.id === Number(lead.status_id));
  const closed = TERMINAL_STATUSES.has(Number(lead.status_id));
  useEffect(() => { if (!open) return; const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; window.addEventListener('mousedown', close); window.addEventListener('keydown', esc); return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); }; }, [open]);
  const send = async (stage: Stage, confirmed: boolean) => {
    setOpen(false); setConfirm(null);
    await write.run({ type: 'entity.update', operationId: newOperationId(), entity: 'leads', entityId: lead.id, baseUpdatedAt: typeof lead.updated_at === 'number' ? lead.updated_at : null, changes: { statusId: stage.id, ...(pipelineId !== Number(lead.pipeline_id) ? { pipelineId } : {}) }, original: { status: comparable(lead, 'status') }, confirmTerminal: confirmed });
  };
  const pick = (stage: Stage) => { if (stage.id === Number(lead.status_id) && pipelineId === Number(lead.pipeline_id)) { setOpen(false); return; } if (TERMINAL_STATUSES.has(stage.id) || closed) { setOpen(false); setConfirm(stage); } else void send(stage, false); };
  const stages = pipelineStages(pipelines.find(p => p.id === pipelineId)).filter(s => s.type !== 1);
  return <div className="field-row stage-row"><span className="field-label">Этап</span><div className="field-control stage-control" ref={box}>
    <button className={`stage-button${closed ? ' closed' : ''}`} disabled={!canWrite || write.saving} aria-label="Изменить этап" title={writeBlock ?? `Этап: ${current?.name ?? 'неизвестен'}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setPipelineId(Number(lead.pipeline_id)); setOpen(!open); }}>
      <StageBadge stage={current?.name ?? 'Этап неизвестен'}/><span className="stage-pipeline">{String(currentPipeline?.name ?? '')}</span>{canWrite ? <ChevronDown size={15}/> : <Lock size={13}/>}
    </button>
    <SaveIndicator state={write.state} onRefresh={() => void onRefresh()}/>
    {open && <div className="stage-popover" role="listbox" aria-label="Этапы сделки">
      {pipelines.length > 1 && <label className="field stage-pipeline-select">Воронка<span className="select"><select value={pipelineId} onChange={e => setPipelineId(Number(e.target.value))}>{pipelines.map(p => <option key={p.id} value={p.id}>{String(p.name ?? `Воронка ${p.id}`)}</option>)}</select></span></label>}
      {pipelineId !== Number(lead.pipeline_id) && <p className="stage-hint">Выберите этап в новой воронке — без этого сделку не перенести.</p>}
      <div className="stage-options">{stages.map(stage => { const active = stage.id === Number(lead.status_id) && pipelineId === Number(lead.pipeline_id); return <button key={stage.id} role="option" aria-selected={active} className={`stage-option${active ? ' active' : ''}${TERMINAL_STATUSES.has(stage.id) ? ' terminal' : ''}`} onClick={() => pick(stage)}><span className="stage-dot" style={stage.color ? { background: stage.color } : undefined}/>{stage.name}{active && <Check size={15}/>}</button>; })}</div>
    </div>}
    {confirm && <Modal title={closed && !TERMINAL_STATUSES.has(confirm.id) ? 'Вернуть сделку в работу?' : `Перевести сделку в «${confirm.name}»?`} icon={CircleAlert} onClose={() => setConfirm(null)}>
      <p>{closed && !TERMINAL_STATUSES.has(confirm.id) ? `Сделка «${String(lead.name ?? '')}» снова станет открытой на этапе «${confirm.name}».` : confirm.id === 142 ? `Сделка «${String(lead.name ?? '')}» будет закрыта как успешная в amoCRM.` : `Сделка «${String(lead.name ?? '')}» будет закрыта как нереализованная в amoCRM.`}</p>
      <div className="modal-actions"><button className="btn" onClick={() => setConfirm(null)}>Отмена</button><button className={`btn ${confirm.id === 143 ? 'btn-danger' : 'btn-primary'}`} onClick={() => void send(confirm, true)}>{closed && !TERMINAL_STATUSES.has(confirm.id) ? 'Вернуть в работу' : 'Перевести'}</button></div>
    </Modal>}
  </div></div>;
}
