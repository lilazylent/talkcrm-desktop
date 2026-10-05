import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../src/services/contracts.ts';
import type { SyncProgress } from '../src/domain/crm.ts';

const api: DesktopApi = {
  findMeetingClients:id=>ipcRenderer.invoke('matching:find',id),
  confirmMeetingClient:(id,selection)=>ipcRenderer.invoke('matching:confirm',id,selection),
  unlinkMeetingClient:id=>ipcRenderer.invoke('matching:unlink',id),
  getTranscriptLocation:(id,segmentId)=>ipcRenderer.invoke('matching:segment',id,segmentId),
  getSnapshot: () => ipcRenderer.invoke('snapshot'),
  setTaskCompleted: (id, completed) => ipcRenderer.invoke('task:setCompleted', id, completed),
  updateProfile: displayName => ipcRenderer.invoke('profile:update', displayName),
  setSetting: (key, value) => ipcRenderer.invoke('setting:update', key, value),
  resetDemo: () => ipcRenderer.invoke('demo:reset'),
  setWindowTheme: dark => ipcRenderer.invoke('window:theme', dark),
  connectCrm: input=>ipcRenderer.invoke('crm:connect',input),
  openCrmBrowser: domain=>ipcRenderer.invoke('crm:browserOpen',domain),
  verifyCrmBrowser: ()=>ipcRenderer.invoke('crm:browserVerify'),
  syncCrm: ()=>ipcRenderer.invoke('crm:sync'),
  disconnectCrm: purge=>ipcRenderer.invoke('crm:disconnect',purge),
  writeCrm: command=>ipcRenderer.invoke('crm:write',command),
  refreshWorkspace: clientId=>ipcRenderer.invoke('crm:refreshWorkspace',clientId),
  getTimeline: clientId=>ipcRenderer.invoke('crm:timeline',clientId),
  openKontur:domain=>ipcRenderer.invoke('kontur:open',domain),
  connectKontur:input=>ipcRenderer.invoke('kontur:connect',input),
  syncKontur:()=>ipcRenderer.invoke('kontur:sync'),
  disconnectKontur:purge=>ipcRenderer.invoke('kontur:disconnect',purge),
  getMeetingArtifacts:id=>ipcRenderer.invoke('kontur:artifacts',id),
  getTranscriptPage:(id,offset,limit,search)=>ipcRenderer.invoke('kontur:transcript',id,offset,limit,search),
  openTalkRecording:(id,recordingId)=>ipcRenderer.invoke('kontur:recording',id,recordingId),
  onKonturProgress:listener=>{const handler=(_event:Electron.IpcRendererEvent,value:import('../src/domain/kontur.ts').KonturProgress)=>listener(value);ipcRenderer.on('kontur:progress',handler);return()=>ipcRenderer.removeListener('kontur:progress',handler);},
  onSyncProgress: listener=>{const handler=(_event:Electron.IpcRendererEvent,progress:SyncProgress)=>listener(progress);ipcRenderer.on('crm:progress',handler);return()=>{ipcRenderer.removeListener('crm:progress',handler);};}
};
contextBridge.exposeInMainWorld('talkcrm', api);
