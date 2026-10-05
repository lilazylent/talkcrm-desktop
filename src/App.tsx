import { useEffect, useMemo, useState, createContext, useContext, Component, useCallback, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, BriefcaseBusiness, CalendarDays, ListTodo, FileText, Settings as SettingsIcon, RotateCcw, Search, RefreshCw, PanelLeftClose, PanelLeftOpen, Moon, Sun, MonitorSmartphone, CircleAlert, Check, X, type LucideIcon } from 'lucide-react';
import type { AppSnapshot } from './domain/models.ts';
import { activeDeal, formatDate } from './domain/models.ts';
import type { DesktopApi } from './services/contracts.ts';
import type { CrmResult, SyncProgress } from './domain/crm.ts';
import { getBrowserDemoApi } from './services/browserDemo.ts';
import { Dashboard, ClientsPage, ClientDetailsPage, DealsPage, MeetingsPage, MeetingDetailsPage, TasksPage, TemplatesPage, SettingsPage } from './pages/Screens.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Logo } from './components/Logo.tsx';
import { Avatar, EmptyState, Modal, Notice } from './components/ui.tsx';
import '@fontsource-variable/onest';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import './styles/workspace.css';

export type ThemeChoice = 'system'|'light'|'dark';
interface AppState { api: DesktopApi; reload: () => Promise<void>; online: boolean; canWrite: boolean; writeBlock: string | null; dirty: (key: string, value: boolean) => void; guard: (proceed: () => void) => void; data: AppSnapshot; busy: boolean; error: string | null; mutate: (work: (api: DesktopApi) => Promise<AppSnapshot>) => Promise<void>; clearError: () => void; crmAction?: (work:(api:DesktopApi)=>Promise<CrmResult>)=>Promise<CrmResult>; progress?:SyncProgress|null; theme: ThemeChoice; setTheme: (theme: ThemeChoice) => void; openPalette: () => void }
const StateContext = createContext<AppState | null>(null);
export function useApp(): AppState { const state = useContext(StateContext); if (!state) throw new Error('Application context missing'); return state; }

const readLocal = (key: string): string | null => { try { return window.localStorage.getItem(key); } catch { return null; } };
const writeLocal = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ } };
const prefersDark = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
const overlayVisible = () => !!(navigator as Navigator & { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible;

function useTheme(api: DesktopApi | undefined): [ThemeChoice, (theme: ThemeChoice) => void] {
  const [theme, setThemeState] = useState<ThemeChoice>(() => (readLocal('talkcrm.theme') as ThemeChoice | null) ?? 'system');
  useEffect(() => {
    const apply = () => {
      const root = document.documentElement;
      if (theme === 'system') delete root.dataset.theme; else root.dataset.theme = theme;
      void api?.setWindowTheme?.(theme === 'dark' || (theme === 'system' && prefersDark()));
    };
    apply();
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)'); media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [theme, api]);
  return [theme, (next: ThemeChoice) => { writeLocal('talkcrm.theme', next); setThemeState(next); }];
}

interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: number; tone?: 'danger'|'warning' }
function Sidebar({ data, collapsed, onToggle }: { data: AppSnapshot; collapsed: boolean; onToggle: () => void }) {
  const { theme, setTheme, guard } = useApp(); const navigate = useNavigate();
  const now = new Date().toISOString();
  const overdue = data.tasks.filter(task => !task.completed && task.dueAt && task.dueAt < now).length;
  const review = data.meetings.filter(meeting => !meeting.crmLink?.confirmed && meeting.matchingStatus !== 'linked' || meeting.crmLink?.status === 'needs_review').length;
  const work: NavItem[] = [
    { to: '/', label: 'Главная', icon: LayoutDashboard, end: true }, { to: '/meetings', label: 'Встречи', icon: CalendarDays, badge: review, tone: 'warning' },
    { to: '/clients', label: 'Клиенты', icon: Users }, { to: '/deals', label: 'Сделки', icon: BriefcaseBusiness, badge: data.deals.filter(activeDeal).length },
    { to: '/tasks', label: 'Задачи', icon: ListTodo, badge: overdue, tone: 'danger' }
  ];
  const system: NavItem[] = [{ to: '/templates', label: 'Шаблоны', icon: FileText }, { to: '/settings', label: 'Настройки', icon: SettingsIcon }];
  const link = (item: NavItem) => <NavLink key={item.to} to={item.to} end={item.end} onClick={event => { event.preventDefault(); guard(() => navigate(item.to)); }} aria-label={item.label} title={collapsed ? item.label : undefined} className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}><item.icon size={19} strokeWidth={1.9}/><span className="sb-label">{item.label}</span>{!!item.badge && <span aria-hidden="true" className={`sb-badge${item.tone ? ' ' + item.tone : ''}`}><span>{item.badge}</span></span>}</NavLink>;
  const crm = data.crm?.account; const kontur = data.kontur;
  const sources = [
    { name: 'amoCRM', state: crm ? (crm.authorized ? (crm.state === 'failed' ? 'err' : crm.state === 'partial_error' ? 'warn' : 'on') : 'warn') : 'off', detail: crm ? (crm.authorized ? 'Подключено' : 'Только кэш') : 'Не подключено' },
    { name: 'Контур.Толк', state: kontur ? (kontur.state === 'connected' || kontur.state === 'syncing' ? 'on' : kontur.state === 'failed' ? 'err' : kontur.state === 'needs_login' ? 'warn' : 'off') : 'off', detail: kontur ? ({ connected: 'Подключено', syncing: 'Обновление', needs_login: 'Нужен вход', failed: 'Ошибка', disconnected: 'Отключено' })[kontur.state] : 'Не подключено' }
  ];
  const nextTheme: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : MonitorSmartphone;
  return <aside className="sidebar">
    <div className="sb-brand"><Logo className="brand-logo" size={40}/><div className="sb-label"><strong>TalkCRM</strong><small>встречи → сделки</small></div></div>
    <nav className="sb-nav" aria-label="Основная навигация"><div className="sb-caption sb-label">Работа</div>{work.map(link)}<div className="sb-caption sb-label">Система</div>{system.map(link)}</nav>
    <div className="sb-sources">{sources.map(source => <NavLink to="/settings" key={source.name} className="sb-source" title={`${source.name}: ${source.detail}`} tabIndex={-1}><span className={`live-dot ${source.state === 'on' ? '' : source.state}`}/><span className="sb-label"><strong>{source.name}</strong><small>{source.detail}</small></span></NavLink>)}</div>
    <div className="sb-footer">
      <Avatar name={data.profile.displayName} round/>
      <div className="sb-label sb-profile"><strong>{data.profile.displayName}</strong><small>Версия {data.version}</small></div>
      <button className="sb-icon" onClick={() => setTheme(nextTheme[theme])} aria-label={`Тема: ${({ system: 'как в системе', light: 'светлая', dark: 'тёмная' })[theme]}`} title="Сменить тему"><ThemeIcon size={17}/></button>
      <button className="sb-icon" onClick={onToggle} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>{collapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</button>
    </div>
  </aside>;
}

function Topbar({ data, busy, progress, onSync }: { data: AppSnapshot; busy: boolean; progress: SyncProgress | null; onSync: () => void }) {
  const { openPalette } = useApp();
  const real = data.settings.data_mode === 'amocrm'; const account = data.crm?.account;
  const source = real ? `amoCRM · ${account?.name ?? 'Кэш'}` : data.kontur ? 'Контур.Толк · CRM не подключена' : 'Демо-режим';
  const pct = progress?.total ? Math.min(100, Math.round(progress.completed / progress.total * 100)) : null;
  return <div className={`topbar${overlayVisible() ? ' has-overlay' : ''}`}>
    <button className="topbar-search" onClick={openPalette}><Search size={17}/><span>Поиск клиентов, сделок и встреч</span><kbd>Ctrl</kbd><kbd>K</kbd></button>
    <div className="topbar-drag"/>
    {busy && progress ? <div className="topbar-sync" role="status"><span className="spinner"/>{progress.stage}{progress.total !== null ? ` ${progress.completed} / ${progress.total}` : progress.completed ? ` ${progress.completed}` : ''}</div>
      : <div className="topbar-meta"><span className={`source-chip${real ? ' real' : data.kontur ? ' real' : ''}`}><span className={`live-dot${real || data.kontur ? '' : ' off'}`}/>{source}</span>{real && account && <span className="topbar-cache" title="Сохранённые данные">{account.lastSyncAt ? `Обновлено ${formatDate(account.lastSyncAt)}` : 'Синхронизации ещё не было'}{!account.authorized ? ' · подключение отключено' : ''}</span>}</div>}
    {account?.authorized && real && <button className="btn btn-sm" disabled={busy} onClick={onSync}><RefreshCw size={15} className={busy ? 'spin' : ''}/>Обновить</button>}
    {busy && <div className={`progress-line${pct !== null ? ' determinate' : ''}`}>{pct !== null && <span style={{ width: `${pct}%` }}/>}</div>}
  </div>;
}

function ScrollReset() { const { pathname } = useLocation(); useEffect(() => { document.querySelector('.content')?.scrollTo?.({ top: 0, behavior: 'instant' }); }, [pathname]); return null; }

function AppContent() {
  const [data, setData] = useState<AppSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress,setProgress]=useState<SyncProgress|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [palette, setPalette] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [dirtyKeys, setDirtyKeys] = useState<string[]>([]); const [pending, setPending] = useState<(() => void) | null>(null);
  const [collapsed, setCollapsed] = useState(() => readLocal('talkcrm.sidebar') === 'collapsed');
  const api = useMemo(() => window.talkcrm ?? (import.meta.env.DEV ? getBrowserDemoApi() : undefined), []);
  const [theme, setTheme] = useTheme(api);
  useEffect(() => {
    if (!api) { setError('Откройте приложение TalkCRM Desktop.'); return; }
    api.getSnapshot().then(setData).catch(() => setError('Не удалось загрузить данные. Перезапустите приложение.'));
  }, [api]);
  useEffect(()=>api?.onSyncProgress(setProgress),[api]);
  useEffect(()=>api?.onKonturProgress(p=>setProgress({state:'running',stage:p.message,completed:p.completed,total:p.total})),[api]);
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(null), 7000); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' || (event.ctrlKey || event.metaKey) && event.code === 'KeyK') { event.preventDefault(); setPalette(open => !open); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { const up = () => setOnline(true), down = () => setOnline(false); window.addEventListener('online', up); window.addEventListener('offline', down); return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); }; }, []);
  useEffect(() => { if (!dirtyKeys.length) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirtyKeys.length]);
  const openPalette = useCallback(() => setPalette(true), []);
  const dirty = useCallback((key: string, value: boolean) => setDirtyKeys(keys => value ? (keys.includes(key) ? keys : [...keys, key]) : keys.filter(k => k !== key)), []);
  const guard = useCallback((proceed: () => void) => { if (dirtyKeys.length) setPending(() => proceed); else proceed(); }, [dirtyKeys.length]);
  const reload = useCallback(async () => { if (api) setData(await api.getSnapshot()); }, [api]);
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
  if (!data) return <div className="full-state"><Logo className="brand-logo" size={72}/><h1>TalkCRM</h1><p>{error ?? 'Загружаем рабочее пространство…'}</p>{!error && <div className="boot-line"/>}{error && <button className="btn btn-primary" onClick={() => window.location.reload()}><RotateCcw size={16}/>Повторить</button>}</div>;
  const account = data.crm?.account; const realMode = data.settings.data_mode === 'amocrm';
  const writeBlock = !realMode || !account ? 'Редактирование доступно после подключения amoCRM.' : !account.authorized ? 'Подключение к amoCRM отключено. Данные доступны только для просмотра.' : !online ? 'Нет соединения с amoCRM. Данные доступны только для просмотра.' : null;
  const toggle = () => { const next = !collapsed; setCollapsed(next); writeLocal('talkcrm.sidebar', next ? 'collapsed' : 'expanded'); };
  return <StateContext.Provider value={{ api: api!, reload, online, canWrite: !writeBlock, writeBlock, dirty, guard, data, busy, error, mutate, crmAction,progress, clearError: () => setError(null), theme, setTheme, openPalette }}>
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <Sidebar data={data} collapsed={collapsed} onToggle={toggle}/>
      <main className="main">
        <Topbar data={data} busy={busy} progress={progress} onSync={() => void crmAction(api => api.syncCrm())}/>
        <div className="content"><ScrollReset/><div className="page">
          {realMode && account && writeBlock && account.authorized && <div className="page-alert"><Notice tone="warning" icon={CircleAlert} role="status">{writeBlock}</Notice></div>}
          {error && <div className="page-alert"><Notice tone="danger" icon={CircleAlert} role="alert" onClose={() => setError(null)}>{error}</Notice></div>}
          <Routes>
            <Route path="/" element={<Dashboard/>}/><Route path="/clients" element={<ClientsPage/>}/><Route path="/clients/:id" element={<ClientDetailsPage/>}/>
            <Route path="/deals" element={<DealsPage/>}/><Route path="/meetings" element={<MeetingsPage/>}/><Route path="/meetings/:id" element={<MeetingDetailsPage/>}/>
            <Route path="/tasks" element={<TasksPage/>}/><Route path="/templates" element={<TemplatesPage/>}/><Route path="/settings" element={<SettingsPage/>}/>
            <Route path="*" element={<EmptyState title="Страница не найдена"/>}/>
          </Routes>
        </div></div>
      </main>
      {message && <div className="toasts"><div className="toast" role="status"><span className="toast-icon"><Check size={16}/></span><div className="grow">{message}</div><button className="icon-btn" onClick={() => setMessage(null)} aria-label="Скрыть результат"><X size={16}/></button></div></div>}
      {palette && <CommandPalette data={data} onClose={() => setPalette(false)}/>}
      {pending && <Modal title="Уйти без сохранения?" icon={CircleAlert} onClose={() => setPending(null)}><p>Изменения в карточке ещё не сохранены в amoCRM. Если уйти, они пропадут.</p><div className="modal-actions"><button className="btn" onClick={() => setPending(null)}>Остаться</button><button className="btn btn-danger" onClick={() => { const go = pending; setPending(null); setDirtyKeys([]); go(); }}>Уйти без сохранения</button></div></Modal>}
    </div>
  </StateContext.Provider>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render(): ReactNode { return this.state.failed ? <div className="full-state"><Logo className="brand-logo" size={72}/><h1>Что-то пошло не так</h1><p>Перезапустите экран. Ваши данные сохранены.</p><button className="btn btn-primary" onClick={() => window.location.reload()}><RotateCcw size={16}/> Перезапустить экран</button></div> : this.props.children; }
}
export default function App() { return <ErrorBoundary><HashRouter><AppContent/></HashRouter></ErrorBoundary>; }
