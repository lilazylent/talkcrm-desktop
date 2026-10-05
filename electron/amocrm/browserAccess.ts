import { randomUUID } from 'node:crypto';
import { BrowserWindow, session, safeStorage, type Session } from 'electron';
import type { SecureCredentialStore } from '../../src/services/contracts.ts';
import { AmoClient } from './client.ts';
import { allowedLoginUrl, browserCredentialKey, cookieBundle } from './browserPolicy.ts';
import { CrmError, endpoint, normalizeDomain, writeEndpoint } from './security.ts';
import { Transport } from './transport.ts';
export interface BrowserAccess {
  open(domain:string,accountId?:string):Promise<void>;
  client(domain:string,accountId?:string):Promise<AmoClient>;
  persist(domain:string,accountId:string):Promise<void>;
  clear():Promise<void>;
  close():void;
}
export class ElectronBrowserAccess implements BrowserAccess{
  private sessions=new Map<string,Session>();private window:BrowserWindow|null=null;
  constructor(private readonly store:SecureCredentialStore,private readonly log:(line:string)=>void=()=>{}){}
  private async getSession(domain:string,accountId?:string):Promise<Session>{
    domain=normalizeDomain(domain);const existing=this.sessions.get(domain);if(existing)return existing;
    if(process.platform!=='win32'||!safeStorage.isEncryptionAvailable())throw new CrmError('browser_encryption','Шифрование Windows недоступно. Подключение не сохранено.');
    const ses=session.fromPartition(`talkcrm-amo-${randomUUID()}`,{cache:false});
    ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));ses.setPermissionCheckHandler(()=>false);
    ses.on('will-download',event=>event.preventDefault());
    try{
      if(accountId){const secret=await this.store.get(browserCredentialKey(accountId));if(!secret)throw new CrmError('browser_missing','Войдите в amoCRM через браузер приложения заново.');const bundle=cookieBundle(JSON.parse(secret),domain);
        for(const cookie of bundle.cookies){if(cookie.expirationDate!==undefined&&cookie.expirationDate<=Date.now()/1000)continue;const {hostOnly,...rest}=cookie;await ses.cookies.set({...rest,...(hostOnly?{domain:undefined}:{}),url:`https://${cookie.domain.replace(/^\./,'')}${cookie.path}`});}
      }
      this.sessions.set(domain,ses);return ses;
    }catch(error){await ses.clearStorageData();throw error;}
  }
  async open(domain:string,accountId?:string):Promise<void>{
    domain=normalizeDomain(domain);let ses:Session;
    try{ses=await this.getSession(domain,accountId);}catch(error){if(!(error instanceof CrmError)||error.code!=='browser_missing')throw error;ses=await this.getSession(domain);}
    this.close();const win=new BrowserWindow({width:1280,height:850,title:`amoCRM · ${domain} · Вход на сайте`,autoHideMenuBar:true,webPreferences:{session:ses,contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});this.window=win;
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(!allowedLoginUrl(url,domain))event.preventDefault();});
    win.webContents.on('will-redirect',(event,url)=>{if(!allowedLoginUrl(url,domain))event.preventDefault();});
    win.webContents.on('will-attach-webview',event=>event.preventDefault());
    win.on('closed',()=>{if(this.window===win)this.window=null;});
    // The user completes authentication on the official page. No script reads login forms.
    void win.loadURL(`https://${domain}/`).catch(()=>this.log('browser page_load_failed'));
  }
  async client(domain:string,accountId?:string):Promise<AmoClient>{
    domain=normalizeDomain(domain);const ses=await this.getSession(domain,accountId);
    const fetcher:typeof fetch=async(input,options)=>{
      const url=new URL(String(input));const method=options?.method??'GET';
      // Reads use the read allowlist; user-initiated writes are limited to the explicit mutation allowlist.
      if(method==='GET')endpoint(domain,url.href);else if(method==='POST'||method==='PATCH')writeEndpoint(domain,method,url.pathname+url.search);else throw new CrmError('endpoint','Недопустимый запрос amoCRM.');
      return ses.fetch(url.href,{...options,credentials:'include'});
    };
    return new AmoClient(domain,null,new Transport(fetcher,undefined,undefined,this.log),{'X-Requested-With':'XMLHttpRequest'});
  }
  async persist(domain:string,accountId:string):Promise<void>{
    const ses=this.sessions.get(domain);if(!ses)throw new CrmError('browser_missing','Откройте окно входа в amoCRM.');
    const cookies=(await ses.cookies.get({})).filter(c=>typeof c.domain==='string'&&allowedLoginUrl(`https://${c.domain.replace(/^\./,'')}/`,domain));
    const bundle=cookieBundle({domain,cookies},domain);await this.store.set(browserCredentialKey(accountId),JSON.stringify(bundle));
  }
  close():void{this.window?.close();this.window=null;}
  async clear():Promise<void>{this.close();for(const ses of this.sessions.values())await ses.clearStorageData();this.sessions.clear();}
}
