import {BrowserWindow,session,type Session} from 'electron';
import {allowedTalkLogin,KonturError,normalizeTalkDomain} from './security.ts';
export class TalkSession {
  private ses:Session;private window:BrowserWindow|null=null;private domain='';private authorization:string|null=null;
  constructor(){this.ses=session.fromPartition('persist:kontur-talk');this.ses.setPermissionRequestHandler((_w,_p,done)=>done(false));this.ses.setPermissionCheckHandler(()=>false);this.ses.on('will-download',event=>event.preventDefault());this.ses.webRequest.onBeforeSendHeaders({urls:['https://*.ktalk.ru/api/*']},(details,done)=>{if(details.method==='GET'&&this.window&&!this.window.isDestroyed()&&new URL(details.url).hostname===this.domain){const h=Object.entries(details.requestHeaders).find(([k])=>k.toLowerCase()==='authorization')?.[1];if(typeof h==='string'&&/^Session [^\r\n]{1,4096}$/.test(h))this.authorization=h;}done({requestHeaders:details.requestHeaders});});}
  async open(domain:string,visible=true):Promise<void>{
    const normalized=normalizeTalkDomain(domain);if(this.domain!==normalized){this.authorization=null;this.window?.destroy();this.window=null;this.domain=normalized;}
    if(this.window&&!this.window.isDestroyed()){if(visible){this.authorization=null;this.window.show();this.window.focus();void this.window.loadURL(`https://${this.domain}/content/artifacts/recordings`).catch(()=>{});}return;}
    const win=new BrowserWindow({width:1200,height:850,show:visible,title:'Контур.Толк — подключение TalkCRM',webPreferences:{partition:'persist:kontur-talk',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});this.window=win;win.removeMenu();win.on('page-title-updated',e=>e.preventDefault());win.on('closed',()=>{if(this.window===win)this.window=null;});
    const guard=(event:Electron.Event,url:string)=>{if(!allowedTalkLogin(url,this.domain))event.preventDefault();};win.webContents.on('will-navigate',guard);win.webContents.on('will-redirect',guard);win.webContents.setWindowOpenHandler(({url})=>{if(allowedTalkLogin(url,this.domain))void win.loadURL(url).catch(()=>{});return{action:'deny'};});
    void win.loadURL(`https://${this.domain}/content/artifacts/recordings`).catch(()=>{});
  }
  async ready(domain:string):Promise<void>{await this.open(domain,false);for(let i=0;i<75;i++){if(this.authorization)return;await new Promise(resolve=>setTimeout(resolve,200));}throw new KonturError('login','Войдите в Толк в окне подключения, затем нажмите «Проверить подключение».',401);}
  finishLogin():void{this.window?.hide();}
  headers():Record<string,string>{if(!this.authorization)throw new KonturError('login','Войдите снова в Толк.',401);return{Authorization:this.authorization};}
  fetch=(url:string,init:RequestInit):Promise<Response>=>this.ses.fetch(url,init);
  async clear():Promise<void>{this.authorization=null;this.window?.destroy();this.window=null;await this.ses.clearStorageData();await this.ses.clearCache();await this.ses.closeAllConnections();}
  close():void{this.authorization=null;this.window?.destroy();this.window=null;}
}
