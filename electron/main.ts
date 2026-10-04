import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } from 'electron';
import {KonturService} from './kontur/service.ts';
import {TalkSession} from './kontur/session.ts';
import {sourceRecordingUrl} from './kontur/security.ts';
import { SqliteRepository } from './repository.ts';
import { LocalLogger } from './logger.ts';
import { CrmService } from './amocrm/service.ts';
import { Transport } from './amocrm/transport.ts';
import { ElectronCredentialStore } from './credentialStore.ts';
import { ElectronBrowserAccess } from './amocrm/browserAccess.ts';

let repository: SqliteRepository;
let logger: LocalLogger;
let crm: CrmService;
let kontur:KonturService;
let talkSession:TalkSession;
let mainWindow: BrowserWindow|null=null;
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});

if (process.env.TALKCRM_TEST_USER_DATA) {
  const testDirectory = path.resolve(process.env.TALKCRM_TEST_USER_DATA);
  fs.mkdirSync(testDirectory, { recursive: true });
  app.setPath('userData', testDirectory);
}
const ownsInstance=app.requestSingleInstanceLock();
if(!ownsInstance)app.quit();

const safeHandle = <A extends unknown[]>(channel: string, action: (...args: A) => Promise<unknown>): void => {
  ipcMain.handle(channel, async (event, ...args: A) => {
    if(!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('IPC sender rejected');
    try { return await action(...args); }
    catch {
      logger.write('error', `${channel}: operation_failed`);
      throw new Error('Не удалось выполнить действие. Попробуйте ещё раз.');
    }
  });
};

// Window chrome follows the renderer theme; colours mirror --bg / --text-2 tokens.
const windowTheme = (dark: boolean) => ({ background: dark ? '#080c18' : '#f3f5fa', overlay: { color: dark ? '#080c18' : '#f3f5fa', symbolColor: dark ? '#aab3c9' : '#465065', height: 56 } });

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1060, minHeight: 700, show: false,
    backgroundColor: windowTheme(nativeTheme.shouldUseDarkColors).background, title: 'TalkCRM Desktop',
    titleBarStyle: 'hidden', titleBarOverlay: windowTheme(nativeTheme.shouldUseDarkColors).overlay,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow=window;
  window.on('closed',()=>{mainWindow=null;talkSession?.close();});
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.TALKCRM_DEV_URL) await window.loadURL(process.env.TALKCRM_DEV_URL);
  else await window.loadFile(path.join(app.getAppPath(), 'dist-web', 'index.html'));
  window.show();
}

app.whenReady().then(async () => {
  if(!ownsInstance)return;
  app.setAppUserModelId('ru.talkcrm.desktop');
  const userData = app.getPath('userData');
  logger = new LocalLogger(path.join(userData, 'logs'));
  repository = new SqliteRepository(path.join(userData, 'talkcrm.sqlite'), path.join(app.getAppPath(), 'migrations'), app.getAppPath(), app.getVersion());
  const store=new ElectronCredentialStore(path.join(userData,'credentials'));const httpLog=(line:string)=>logger.write('info',line);
  crm=new CrmService(repository,store,new Transport(fetch,undefined,undefined,httpLog),progress=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('crm:progress',progress);},new ElectronBrowserAccess(store,httpLog));
  talkSession=new TalkSession();kontur=new KonturService(repository,store,talkSession,progress=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('kontur:progress',progress);});
  try { await repository.initialize(); logger.write('info', 'Application database initialized'); }
  catch (error) { logger.write('error', `Initialization failed: ${error instanceof Error ? error.message : String(error)}`); dialog.showErrorBox('Не удалось запустить TalkCRM', 'Не удалось подготовить локальные данные. Проверьте папку приложения.'); app.quit(); return; }
  safeHandle('snapshot', () => repository.snapshot());
  safeHandle('task:setCompleted', async (id: string, completed: boolean) => { await repository.setTaskCompleted(id, completed); return repository.snapshot(); });
  safeHandle('profile:update', async (name: string) => { await repository.updateProfile(name); return repository.snapshot(); });
  safeHandle('setting:update', async (key: string, value: string) => { await repository.setSetting(key, value); return repository.snapshot(); });
  safeHandle('window:theme', async (dark: unknown) => { if (typeof dark !== 'boolean' || !mainWindow) return; const theme = windowTheme(dark); mainWindow.setBackgroundColor(theme.background); mainWindow.setTitleBarOverlay(theme.overlay); });
  safeHandle('demo:reset', async () => { await repository.resetDemo(); logger.write('warning', 'Demo data reset'); return repository.snapshot(); });
  safeHandle('crm:connect', input=>crm.connect(input));
  safeHandle('crm:browserOpen', domain=>crm.openBrowser(domain));
  safeHandle('crm:browserVerify', ()=>crm.verifyBrowser());
  safeHandle('crm:sync', ()=>crm.sync());
  safeHandle('crm:disconnect', (purge:boolean)=>crm.disconnect(purge));
  safeHandle('kontur:open',domain=>kontur.open(domain));
  safeHandle('kontur:connect',(input:import('../src/domain/kontur.ts').KonturConnectInput)=>kontur.connect(input));
  safeHandle('kontur:sync',()=>kontur.sync());
  safeHandle('kontur:disconnect',purge=>kontur.disconnect(purge));
  const ownedMeeting=(id:unknown):string=>{if(typeof id!=='string'||id.length>100||!repository.ownsKonturMeeting(id))throw new Error('Invalid meeting');return id;};
  safeHandle('matching:find',async id=>repository.findMeetingClients(id===undefined?undefined:ownedMeeting(id)));
  safeHandle('matching:confirm',async(id:string,selection:import('../src/domain/matching.ts').MatchSelection)=>repository.confirmMeetingClient(ownedMeeting(id),selection));
  safeHandle('matching:unlink',async id=>repository.unlinkMeetingClient(ownedMeeting(id)));
  safeHandle('matching:segment',async(id:string,segmentId:string)=>repository.getTranscriptLocation(ownedMeeting(id),segmentId));
  safeHandle('kontur:artifacts',async id=>repository.getMeetingArtifacts(ownedMeeting(id)));
  safeHandle('kontur:transcript',async(id:string,offset:number,limit:number,search:string)=>repository.getTranscriptPage(ownedMeeting(id),offset,limit,search));
  safeHandle('kontur:recording',async(id,recordingId)=>{const artifacts=repository.getMeetingArtifacts(ownedMeeting(id));const account=repository.getKonturAccount()!;const source=artifacts.artifacts.find(a=>a.type==='recording'&&a.recordingId===recordingId)?.sourceUrl;const url=sourceRecordingUrl(source,account.domain);if(!url)return{ok:false,message:'Ссылка на запись недоступна.'};await shell.openExternal(url);return{ok:true,message:'Запись открыта в Толке.'};});
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch(() => { dialog.showErrorBox('Не удалось запустить TalkCRM', 'Произошла ошибка запуска.'); logger?.write('error', 'Application startup failed'); app.quit(); });

app.on('window-all-closed', () => { repository?.close(); if (process.platform !== 'darwin') app.quit(); });
process.on('uncaughtException', () => { logger?.write('error', 'Unhandled application error'); dialog.showErrorBox('Ошибка приложения', 'Произошла ошибка. Перезапустите TalkCRM Desktop.'); });
