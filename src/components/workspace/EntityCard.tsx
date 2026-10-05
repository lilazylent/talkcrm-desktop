import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Pencil, Search, type LucideIcon } from 'lucide-react';
import { useApp } from '../../App.tsx';
import type { CrmRecord } from '../../domain/crm.ts';
import { comparable, newOperationId, type CrmEntityKind, type EntityChanges } from '../../domain/crmWrite.ts';
import { changeOf, draftOf, fieldViews, sameDraft, type Draft, type FieldView } from '../../domain/workspace.ts';
import { formatMoney } from '../../domain/models.ts';
import { FieldDisplay, FieldInput } from './FieldEditor.tsx';
import { SaveIndicator, useCrmWrite } from './useCrmWrite.tsx';

const nameLabel: Record<CrmEntityKind, string> = { leads: 'Название сделки', contacts: 'Имя контакта', companies: 'Название компании' };
const keyLabel = (key: string, views: FieldView[]) => key === 'name' ? 'Название' : key === 'price' ? 'Бюджет' : views.find(v => `field:${v.id}` === key)?.name ?? 'Поле';

/**
 * One amoCRM entity card. View mode by default; «Редактировать» unlocks inputs; «Сохранить» sends only the changed
 * keys with the values the user saw, so a concurrent remote edit is detected instead of overwritten.
 */
export function EntityCard({ entity, record, title, icon: Icon, headerExtra, primaryCodes = [], currency, onRefresh, full }: { entity: CrmEntityKind; record: CrmRecord; title: string; icon: LucideIcon; headerExtra?: ReactNode; primaryCodes?: string[]; currency?: string | null; onRefresh: () => Promise<void>; full?: boolean }) {
  const { data, canWrite, writeBlock, dirty } = useApp();
  const views = useMemo(() => fieldViews(data.crm ?? { fields: [] }, entity, record), [data.crm, entity, record]);
  const [editing, setEditing] = useState(false); const [base, setBase] = useState<CrmRecord>(record);
  const [name, setName] = useState(''); const [price, setPrice] = useState(''); const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [showAll, setShowAll] = useState(false); const [query, setQuery] = useState(''); const [diff, setDiff] = useState(false);
  const write = useCrmWrite(); const dirtyKey = `card:${entity}:${record.id}`;
  const baseViews = useMemo(() => fieldViews(data.crm ?? { fields: [] }, entity, base), [data.crm, entity, base]);
  const start = () => { setBase(record); setName(String(record.name ?? '')); setPrice(String(record.price ?? 0)); setDrafts(Object.fromEntries(views.filter(v => v.kind !== 'readonly').map(v => [v.id, draftOf(v)]))); setEditing(true); setDiff(false); write.reset(); };
  const changes = (from: CrmRecord = base): EntityChanges => {
    const out: EntityChanges = {}; const fromViews = from === base ? baseViews : fieldViews(data.crm ?? { fields: [] }, entity, from);
    if (name.trim() !== String(from.name ?? '')) out.name = name;
    if (entity === 'leads') { const n = price.trim() === '' ? 0 : Number(price.replace(/\s/g, '')); if (String(n) !== String(from.price ?? 0)) out.price = Number.isFinite(n) ? Math.round(n) : NaN; }
    const fields = fromViews.filter(v => v.kind !== 'readonly' && drafts[v.id] !== undefined && !sameDraft(drafts[v.id], draftOf(v))).map(v => changeOf(v, drafts[v.id]));
    if (fields.length) out.fields = fields;
    return out;
  };
  const pending = editing ? changes() : {}; const pendingKeys = Object.keys(pending).length;
  useEffect(() => { dirty(dirtyKey, editing && pendingKeys > 0); return () => dirty(dirtyKey, false); }, [dirty, dirtyKey, editing, pendingKeys]);
  const save = async (rebase = false) => {
    const from = rebase ? record : base; const c = changes(from); if (!Object.keys(c).length) { setEditing(false); return; }
    const keys = [...(c.name !== undefined ? ['name'] : []), ...(c.price !== undefined ? ['price'] : []), ...(c.fields ?? []).map(f => `field:${f.fieldId}`)];
    const result = await write.run({ type: 'entity.update', operationId: newOperationId(), entity, entityId: record.id, baseUpdatedAt: typeof from.updated_at === 'number' ? from.updated_at : null, changes: c, original: Object.fromEntries(keys.map(k => [k, comparable(from, k)])) });
    if (result?.ok) { setEditing(false); setDiff(false); } else if (result?.status === 'conflict') setDiff(false);
  };
  const conflictKeys = editing && write.state.status === 'conflict' ? Object.keys({ ...(pending.name !== undefined ? { name: 1 } : {}), ...(pending.price !== undefined ? { price: 1 } : {}), ...Object.fromEntries((pending.fields ?? []).map(f => [`field:${f.fieldId}`, 1])) }).filter(k => comparable(base, k) !== comparable(record, k)) : [];
  const primary = views.filter(v => primaryCodes.includes(v.code ?? '')); const rest = views.filter(v => !primaryCodes.includes(v.code ?? '') && !['tracking_data'].includes(v.type));
  const q = query.trim().toLocaleLowerCase('ru-RU');
  const visible = rest.filter(v => (showAll || v.filled || (editing && drafts[v.id] !== undefined && !sameDraft(drafts[v.id], draftOf(v)))) && (!q || v.name.toLocaleLowerCase('ru-RU').includes(q)));
  const groups = new Map<string, FieldView[]>(); for (const v of visible) { const g = v.groupId ?? ''; groups.set(g, [...(groups.get(g) ?? []), v]); }
  const groupName = (id: string) => id ? data.crm?.fieldGroups?.find(g => g.entity === entity && g.id === id)?.name ?? 'Дополнительно' : 'Дополнительные поля';
  const row = (v: FieldView) => <div className={`field-row${editing && v.kind !== 'readonly' ? ' editing' : ''}`} key={v.id}><label className="field-label" htmlFor={`field-${v.id}`}>{v.name}</label><div className="field-control">{editing ? <FieldInput view={v} draft={drafts[v.id] ?? draftOf(v)} disabled={write.saving} onChange={value => setDrafts(d => ({ ...d, [v.id]: value }))}/> : <FieldDisplay view={v}/>}</div></div>;
  const emptyCount = rest.filter(v => !v.filled).length; const limit = full ? Infinity : 6;
  return <section className={`panel entity-card${editing ? ' is-editing' : ''}`}>
    <div className="panel-head"><h2><span className="panel-icon"><Icon size={16}/></span>{title}</h2><span className="spacer"/>{!(editing && write.state.status === 'conflict') && <SaveIndicator state={write.state} onRefresh={() => void onRefresh()}/>}
      {!editing ? <button className="btn btn-sm" disabled={!canWrite} title={writeBlock ?? undefined} onClick={start}><Pencil size={14}/>Редактировать</button>
        : <><button className="btn btn-sm btn-ghost" disabled={write.saving} onClick={() => { setEditing(false); write.reset(); }}>Отмена</button><button className="btn btn-sm btn-primary" disabled={write.saving || !pendingKeys} onClick={() => void save()}>{write.saving ? 'Сохраняем…' : 'Сохранить'}</button></>}
    </div>
    <div className="panel-body">
      {editing && write.state.status === 'conflict' && <div className="conflict-box" role="alert"><strong>Карточка изменилась в amoCRM.</strong><p>Ваши правки не отправлены. Обновите данные и проверьте, что изменилось.</p><div className="row wrap"><button className="btn btn-sm" onClick={() => void onRefresh()}>Обновить данные</button><button className="btn btn-sm btn-ghost" onClick={() => setDiff(!diff)}>Посмотреть изменения</button>{conflictKeys.length > 0 && <button className="btn btn-sm btn-primary" disabled={write.saving} onClick={() => { setBase(record); void save(true); }}>Сохранить мои значения</button>}</div>
        {diff && <ul className="diff-list">{(conflictKeys.length ? conflictKeys : Object.keys(pending)).map(k => <li key={k}><strong>{keyLabel(k, views)}</strong>{conflictKeys.includes(k) ? ' — изменено в amoCRM после открытия карточки' : ' — без изменений в amoCRM'}</li>)}</ul>}</div>}
      <div className="field-section">
        <div className="field-row"><label className="field-label" htmlFor={`name-${entity}`}>{nameLabel[entity]}</label><div className="field-control">{editing ? <input id={`name-${entity}`} className="input" value={name} maxLength={255} disabled={write.saving} onChange={e => setName(e.target.value)}/> : <span className="field-value strong">{String(record.name ?? '—')}</span>}</div></div>
        {entity === 'leads' && <div className="field-row"><label className="field-label" htmlFor="deal-price">Бюджет{currency ? `, ${currency === 'RUB' ? '₽' : currency}` : ''}</label><div className="field-control">{editing ? <><input id="deal-price" className="input" inputMode="numeric" value={price} disabled={write.saving} onChange={e => setPrice(e.target.value.replace(/[^\d\s]/g, ''))}/><small className="field-hint">Пустое поле сохранится как 0. Валюта аккаунта, без пересчёта.</small></> : <span className="field-value mono">{formatMoney(typeof record.price === 'number' ? record.price : 0, currency ?? null)}</span>}</div></div>}
        {headerExtra}
        {primary.map(row)}
      </div>
      {rest.length > 0 && <div className="field-more">
        <div className="field-tools">{(full || showAll) && <label className="search compact"><Search size={15}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти поле" aria-label="Поиск по полям"/></label>}<span className="spacer"/>{emptyCount > 0 && <button className="link-btn" onClick={() => setShowAll(!showAll)}><ChevronDown size={14} className={showAll ? 'flip' : ''}/>{showAll ? 'Скрыть пустые поля' : `Показать все поля · ${rest.length}`}</button>}</div>
        {[...groups.entries()].map(([g, list]) => <div className="field-group-block" key={g}>{(groups.size > 1 || g) && <h3 className="eyebrow">{groupName(g)}</h3>}<div className="field-section">{list.slice(0, showAll || q ? Infinity : limit).map(row)}</div>{!showAll && !q && list.length > limit && <button className="link-btn more-link" onClick={() => setShowAll(true)}>Ещё {list.length - limit}</button>}</div>)}
        {!visible.length && <p className="muted small-copy">{q ? 'Поля не найдены.' : 'Дополнительные поля не заполнены.'}</p>}
      </div>}
    </div>
  </section>;
}
