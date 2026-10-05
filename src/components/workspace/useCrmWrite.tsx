import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, RefreshCw } from 'lucide-react';
import { useApp } from '../../App.tsx';
import type { CrmCommand, CrmWriteResult } from '../../domain/crmWrite.ts';

export type SaveStatus = 'idle'|'saving'|'saved'|'failed'|'conflict'|'needs_refresh';
export interface SaveState { status: SaveStatus; message?: string }

/**
 * Sends one user action to amoCRM through IPC. A ref guard drops repeated clicks while a request is in flight;
 * the UI only shows the new value after amoCRM confirmed it and the snapshot was reloaded.
 */
export function useCrmWrite() {
  const { api, reload, canWrite, writeBlock } = useApp();
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const inFlight = useRef(false);
  useEffect(() => { if (state.status !== 'saved') return; const timer = setTimeout(() => setState({ status: 'idle' }), 4000); return () => clearTimeout(timer); }, [state]);
  const run = async (command: CrmCommand): Promise<CrmWriteResult | null> => {
    if (inFlight.current) return null;
    if (!canWrite) { setState({ status: 'failed', message: writeBlock ?? 'Изменение сейчас недоступно.' }); return null; }
    inFlight.current = true; setState({ status: 'saving', message: 'Сохраняем…' });
    try {
      const result = await api.writeCrm(command);
      await reload().catch(() => {});
      setState({ status: result.ok ? 'saved' : result.status === 'conflict' ? 'conflict' : result.status === 'needs_refresh' ? 'needs_refresh' : 'failed', message: result.message });
      return result;
    } catch { setState({ status: 'failed', message: 'Не удалось сохранить изменение в amoCRM.' }); return null; }
    finally { inFlight.current = false; }
  };
  return { state, run, saving: state.status === 'saving', reset: () => setState({ status: 'idle' }) };
}

export function SaveIndicator({ state, onRefresh }: { state: SaveState; onRefresh?: () => void }) {
  if (state.status === 'idle') return null;
  if (state.status === 'saving') return <span className="save-state saving" role="status"><span className="spinner"/>{state.message}</span>;
  if (state.status === 'saved') return <span className="save-state saved" role="status"><Check size={15}/>{state.message ?? 'Сохранено в amoCRM'}</span>;
  return <span className={`save-state ${state.status === 'failed' ? 'failed' : 'warn'}`} role="alert"><CircleAlert size={15}/>{state.message}{onRefresh && state.status !== 'failed' && <button className="link-btn" onClick={onRefresh}><RefreshCw size={13}/>Обновить данные</button>}</span>;
}
