import { useEffect, useMemo, useState, createContext, useContext, Component, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { LayoutDashboard, Users, BriefcaseBusiness, CalendarDays, ListTodo, FileText, Settings as SettingsIcon, RotateCcw } from 'lucide-react';
import type { AppSnapshot } from './domain/models.ts';
import type { DesktopApi } from './services/contracts.ts';
import type { CrmResult, SyncProgress } from './domain/crm.ts';
import { getBrowserDemoApi } from './services/browserDemo.ts';
import { Dashboard, ClientsPage, ClientDetailsPage, DealsPage, MeetingsPage, MeetingDetailsPage, TasksPage, TemplatesPage, SettingsPage } from './pages/Screens.tsx';
import './styles.css';

interface AppState { data: AppSnapshot; busy: boolean; error: string | null; mutate: (work: (api: DesktopApi) => Promise<AppSnapshot>) => Promise<void>; clearError: () => void; crmAction?: (work:(api:DesktopApi)=>Promise<CrmResult>)=>Promise<CrmResult>; progress?:SyncProgress|null }
const StateContext = createContext<AppState | null>(null);
export function useApp(): AppState { const state = useContext(StateContext); if (!state) throw new Error('Application context missing'); return state; }

function AppContent() {
  const [data, setData] = useState<AppSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress,setProgress]=useState<SyncProgress|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const api = useMemo(() => window.talkcrm ?? (import.meta.env.DEV ? getBrowserDemoApi() : undefined), []);
  useEffect(() => {
    if (!api) { setError('Откройте приложение TalkCRM Desktop.'); return; }
    api.getSnapshot().then(setData).catch(() => setError('Не удалось загрузить данные. Перезапустите приложение.'));
  }, [api]);
  useEffect(()=>api?.onSyncProgress(setProgress),[api]);
  useEffect(()=>api?.onKonturProgress(p=>setProgress({state:'running',stage:p.message,completed:p.completed,total:p.total})),[api]);
  const mutate = async (work: (api: DesktopApi) => Promise<AppSnapshot>) => {
    if (!api || busy) return;
    setBusy(true); setError(null);
    try { setData(await work(api)); }
    catch { setError('Не удалось сохранить изменения. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  };
  const crmAction=async(work:(api:DesktopApi)=>Promise<CrmResult>):Promise<CrmResult>=>{
    if(!api||busy)return{ok:false,message:'Дождитесь текущей операции.'};setBusy(true);setError(null);setMessage(null);setProgress(null);
    try{const result=await work(api);setData(await api.getSnapshot());if(result.ok)setMessage(result.message);else setError(result.message);return result;}
    catch{const result={ok:false,message:'Не удалось выполнить действие. Сохранённые данные доступны.'};setError(result.message);return result;}
    finally{setBusy(false);}
  };
  if (!data) return <div className="full-state"><div className="brand-mark">T</div><h1>TalkCRM Desktop</h1><p>{error ?? 'Загружаем рабочее пространство…'}</p>{error && <button onClick={() => window.location.reload()}>Повторить</button>}</div>;
  const nav = [
    { to: '/', label: 'Главная', icon: LayoutDashboard, end: true }, { to: '/clients', label: 'Клиенты', icon: Users },
    { to: '/deals', label: 'Сделки', icon: BriefcaseBusiness }, { to: '/meetings', label: 'Встречи', icon: CalendarDays },
    { to: '/tasks', label: 'Задачи', icon: ListTodo }, { to: '/templates', label: 'Шаблоны', icon: FileText },
    { to: '/settings', label: 'Настройки', icon: SettingsIcon }
  ];
  return <StateContext.Provider value={{ data, busy, error, mutate, crmAction,progress, clearError: () => setError(null) }}>
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">T</div><div><strong>TalkCRM</strong><small>рабочее пространство</small></div></div>
        <div className="nav-caption">РАБОТА</div>
        <nav aria-label="Основная навигация">{nav.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}><item.icon size={19} strokeWidth={1.9}/><span>{item.label}</span></NavLink>)}</nav>
        <div className="sidebar-bottom"><div className="avatar">{data.profile.displayName.slice(0, 1)}</div><div className="profile-mini"><strong>{data.profile.displayName}</strong><small>Версия {data.version}</small></div></div>
      </aside>
      <main className="main"><div className="topline"><span>РАБОЧЕЕ ПРОСТРАНСТВО</span><div className="crm-top"><span className="demo-indicator"><span/> {data.settings.data_mode==='amocrm'?`amoCRM · ${data.crm?.account?.name??'Кэш'}${data.kontur?' · Контур.Толк':''}`:data.kontur?'Контур.Толк · CRM не подключена':'Демо-режим'}</span>{data.crm?.account?.authorized&&data.settings.data_mode==='amocrm'&&<button className="button secondary" disabled={busy} onClick={()=>void crmAction(api=>api.syncCrm())}>Обновить</button>}</div></div>{busy&&progress&&<div className="sync-banner" role="status">{progress.stage} {progress.total!==null?`${progress.completed} / ${progress.total}`:progress.completed||''}</div>}{message&&<div className="sync-banner" role="status">{message}<button onClick={()=>setMessage(null)} aria-label="Скрыть результат">×</button></div>}{error && <div className="error-banner" role="alert">{error}<button onClick={() => setError(null)} aria-label="Скрыть сообщение">×</button></div>}{data.settings.data_mode==='amocrm'&&data.crm?.account&&<div className="cache-caption">Сохранённые данные · {data.crm.account.lastSyncAt?new Date(data.crm.account.lastSyncAt).toLocaleString('ru-RU'):'Синхронизация ещё не выполнялась'}{!data.crm.account.authorized?' · Подключение отключено':''}</div>}<div className="page"><Routes>
        <Route path="/" element={<Dashboard/>}/><Route path="/clients" element={<ClientsPage/>}/><Route path="/clients/:id" element={<ClientDetailsPage/>}/>
        <Route path="/deals" element={<DealsPage/>}/><Route path="/meetings" element={<MeetingsPage/>}/><Route path="/meetings/:id" element={<MeetingDetailsPage/>}/>
        <Route path="/tasks" element={<TasksPage/>}/><Route path="/templates" element={<TemplatesPage/>}/><Route path="/settings" element={<SettingsPage/>}/>
        <Route path="*" element={<div className="empty-state"><strong>Страница не найдена</strong></div>}/>
      </Routes></div></main>
    </div>
  </StateContext.Provider>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render(): ReactNode { return this.state.failed ? <div className="full-state"><div className="brand-mark">T</div><h1>Что-то пошло не так</h1><p>Перезапустите приложение. Ваши данные сохранены.</p><button onClick={() => window.location.reload()}><RotateCcw size={16}/> Перезапустить экран</button></div> : this.props.children; }
}
export default function App() { return <ErrorBoundary><HashRouter><AppContent/></HashRouter></ErrorBoundary>; }
