import { Lock, Plus, X } from 'lucide-react';
import { MULTITEXT_LABEL, type Draft, type FieldView } from '../../domain/workspace.ts';

/** Read-only presentation of one amoCRM field value. */
export function FieldDisplay({ view }: { view: FieldView }) {
  if (!view.filled) return <span className="field-empty">Не заполнено</span>;
  if (view.type === 'url') return <span className="field-value truncate" title={view.display}>{view.display}</span>;
  if (view.kind === 'multiselect' || view.kind === 'multitext') return <span className="field-chips">{view.display.split(', ').map((part, i) => <span key={i} className="chip">{part}</span>)}</span>;
  return <span className="field-value">{view.display}</span>;
}

/** Editor for one field; unsupported types stay read-only with a plain explanation. */
export function FieldInput({ view, draft, onChange, disabled }: { view: FieldView; draft: Draft; onChange: (value: Draft) => void; disabled?: boolean }) {
  const id = `field-${view.id}`;
  switch (view.kind) {
    case 'readonly': return <div className="field-locked" title="Это поле пока можно изменить только в amoCRM."><FieldDisplay view={view}/><span className="lock-note"><Lock size={13}/>Только в amoCRM</span></div>;
    case 'textarea': return <textarea id={id} className="input textarea" aria-label={view.name} value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)} rows={3}/>;
    case 'number': return <input id={id} className="input" aria-label={view.name} inputMode="decimal" value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)}/>;
    case 'url': return <input id={id} className="input" aria-label={view.name} type="url" placeholder="https://" value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)}/>;
    case 'date': return <input id={id} className="input" aria-label={view.name} type="date" value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)}/>;
    case 'datetime': return <input id={id} className="input" aria-label={view.name} type="datetime-local" value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)}/>;
    case 'checkbox': return <label className="checkbox"><input id={id} type="checkbox" checked={draft === true} disabled={disabled} onChange={e => onChange(e.target.checked)}/>{draft === true ? 'Да' : 'Нет'}</label>;
    case 'select': return <span className="select"><select id={id} aria-label={view.name} value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)}><option value="">— не выбрано —</option>{view.enums.map(e => <option key={e.id} value={e.id}>{e.value}</option>)}</select></span>;
    case 'multiselect': { const chosen = draft as number[]; return <div className="multi-select" role="group" aria-label={view.name}>{view.enums.map(e => <label key={e.id} className={`chip-toggle${chosen.includes(e.id) ? ' on' : ''}`}><input type="checkbox" checked={chosen.includes(e.id)} disabled={disabled} onChange={ev => onChange(ev.target.checked ? [...chosen, e.id] : chosen.filter(x => x !== e.id))}/>{e.value}</label>)}</div>; }
    case 'multitext': return <MultiValueEditor view={view} rows={draft as { value: string; enum_code: string }[]} onChange={onChange} disabled={disabled}/>;
    default: return <input id={id} className="input" aria-label={view.name} value={String(draft)} disabled={disabled} onChange={e => onChange(e.target.value)}/>;
  }
}

/** Phone/email list. Every existing value and its subtype (WORK, MOB…) is kept unless the user removes it. */
function MultiValueEditor({ view, rows, onChange, disabled }: { view: FieldView; rows: { value: string; enum_code: string }[]; onChange: (value: Draft) => void; disabled?: boolean }) {
  const codes = view.enums.map(e => e.value).filter(Boolean); const fallback = codes.includes('WORK') ? 'WORK' : codes[0] ?? '';
  const update = (index: number, patch: Partial<{ value: string; enum_code: string }>) => onChange(rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const isPhone = view.code === 'PHONE';
  return <div className="multi-value">
    {rows.map((row, index) => <div className="multi-row" key={index}>
      <input className="input" aria-label={`${view.name} ${index + 1}`} type={isPhone ? 'tel' : view.code === 'EMAIL' ? 'email' : 'text'} value={row.value} disabled={disabled} placeholder={isPhone ? '+7 900 000-00-00' : view.code === 'EMAIL' ? 'name@company.ru' : ''} onChange={e => update(index, { value: e.target.value })}/>
      {codes.length > 0 && <span className="select"><select aria-label={`Тип: ${view.name} ${index + 1}`} value={row.enum_code} disabled={disabled} onChange={e => update(index, { enum_code: e.target.value })}>{!row.enum_code && <option value="">Без типа</option>}{codes.map(code => <option key={code} value={code}>{MULTITEXT_LABEL[code] ?? code}</option>)}</select></span>}
      <button type="button" className="icon-btn" aria-label={`Удалить значение ${index + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((_, i) => i !== index))}><X size={16}/></button>
    </div>)}
    <button type="button" className="link-btn" disabled={disabled} onClick={() => onChange([...rows, { value: '', enum_code: fallback }])}><Plus size={14}/>Добавить {isPhone ? 'телефон' : view.code === 'EMAIL' ? 'почту' : 'значение'}</button>
  </div>;
}
