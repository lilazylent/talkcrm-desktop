// Development-only observer of our own isolated window. No request bodies,
// headers, credentials or response values are written to disk.
const {app, BrowserWindow, session} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('appData'), 'TalkCRM Desktop'));
const output = path.resolve(__dirname, '../docs/validation/kontur-observed-shapes.json');
const observed = new Map();
if(fs.existsSync(output)) for(const row of JSON.parse(fs.readFileSync(output,'utf8').replace(/^\uFEFF/,''))) observed.set(row.path,row);
const pending = new Map();
const requests = new Map();
const statuses = new Set(['waiting','processing','complete','error','recording','cancelled','notFound','inProgress','failed','success','notAvailable','serviceError','ready','shortSummary','protocol']);
function shape(value, depth=0) {
  if (depth>9) return 'nested';
  if(value===null)return 'null';
  if(Array.isArray(value))return {array:value.length,items:value.slice(0,1).map(x=>shape(x,depth+1))};
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,80).map(([key,v])=>[/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/.test(key)?key:'{dynamic_key}',shape(v,depth+1)]));
  return typeof value==='string'&&statuses.has(value)?{enum:value}:typeof value;
}
function safePath(url) {
  return new URL(url).pathname.split('/').map(p=>/^[0-9a-f]{8}-|^[0-9]+$|@|^[a-zA-Z0-9_-]{19,}$/.test(p)?'{id}':p).join('/');
}
app.whenReady().then(async()=>{
  const ses=session.fromPartition('persist:kontur-talk');
  ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
  ses.setPermissionCheckHandler(()=>false);
  ses.on('will-download',(e)=>e.preventDefault());
  const win=new BrowserWindow({width:1200,height:850,title:'Контур.Толк — подключение TalkCRM',webPreferences:{partition:'persist:kontur-talk',nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.removeMenu();
  win.on('page-title-updated',e=>e.preventDefault());
  const allowed = url=>{try {const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&['samosale-app.ktalk.ru','passport.skbkontur.ru','identity.kontur.ru','auth.kontur.ru','auth-gateway.kontur.ru','app.ktalk.ru','oauth.yandex.ru','passport.yandex.ru','passport.yandex.com'].includes(u.hostname);}catch{return false;}};
  win.webContents.setWindowOpenHandler(({url})=>{if(allowed(url))void win.loadURL(url);return {action:'deny'};});
  const deny=(e,url)=>{if(!allowed(url)){e.preventDefault(); fs.writeFileSync(path.resolve(__dirname,'../.tmp/kontur-navigation.json'),JSON.stringify({blockedHost:new URL(url).hostname}));}};
  win.webContents.on('will-navigate',deny);
  win.webContents.on('will-redirect',deny);
  win.webContents.on('did-fail-load',(_e,code)=>{fs.writeFileSync(path.resolve(__dirname,'../.tmp/kontur-load.json'),JSON.stringify({code}));});
  win.webContents.debugger.attach('1.3');
  void win.webContents.debugger.sendCommand('Network.enable').catch(()=>{});
  win.webContents.debugger.on('message',async(_e,method,params)=>{
    try{
      if(method==='Network.requestWillBeSent') {
        const r=params.request;const u=new URL(r.url);
        if(u.hostname==='samosale-app.ktalk.ru'&&r.method==='GET'&&u.pathname.startsWith('/api/')&&!/auth|login|token|session/i.test(u.pathname)) {
          const h=Object.entries(r.headers).find(([k])=>k.toLowerCase()==='authorization')?.[1];
          requests.set(params.requestId,{method:r.method,auth:typeof h==='string'&&h.startsWith('Session ')?'Authorization: Session':h?'Authorization: other':'cookie/session',queryValues:Object.fromEntries([...u.searchParams].map(([k,v])=>[k, k==='initiator'&&!/[0-9@]/.test(v)&&v.length<15?v:'{value}']))});
        }
      }
      if(method==='Network.responseReceived') {
        const r=params.response;const u=new URL(r.url);
        if(requests.has(params.requestId)&&/json/i.test(r.mimeType)) pending.set(params.requestId,{...requests.get(params.requestId),path:safePath(r.url),status:r.status,query:[...u.searchParams.keys()]});
      }
      if(method==='Network.loadingFinished'&&pending.has(params.requestId)){
        const info=pending.get(params.requestId);pending.delete(params.requestId);
        if(params.encodedDataLength>12_000_000)return;
        const result=await win.webContents.debugger.sendCommand('Network.getResponseBody',{requestId:params.requestId});
        const body=JSON.parse(result.base64Encoded?Buffer.from(result.body,'base64').toString():result.body);
        observed.set(info.path,{...info,shape:shape(body)});
        fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify([...observed.values()],null,2));
      }
    }catch{/* No raw error may contain source data. */}
  });
  await win.loadURL('https://samosale-app.ktalk.ru/content/artifacts/recordings');
});
app.on('window-all-closed',()=>app.quit());
