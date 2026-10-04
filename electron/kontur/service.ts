import {createHash} from 'node:crypto';
import type {KonturAccount,KonturConnectInput,KonturResult,KonturProgress,TalkImport} from '../../src/domain/kontur.ts';
import type {SecureCredentialStore} from '../../src/services/contracts.ts';
import {ApiTalkAdapter,SessionTalkAdapter,type TalkAdapter} from './adapters.ts';
import {TalkTransport,type TalkFetch} from './transport.ts';
import {KonturError,normalizeTalkDomain,safeKonturMessage} from './security.ts';
export interface TalkSessionAccess {open(domain:string,visible?:boolean):Promise<void>;ready(domain:string):Promise<void>;headers():Record<string,string>;fetch:TalkFetch;clear():Promise<void>;finishLogin?():void}
export interface TalkRepository {getKonturAccount():KonturAccount|null;connectKontur(account:KonturAccount):Promise<void>;commitKonturMeetings(account:KonturAccount,items:TalkImport[]):Promise<void>;disconnectKontur(purge:boolean):Promise<void>;startKonturSync(id:string):Promise<string>;finishKonturSync(id:string,state:string,count:number,error:string|null):Promise<void>}
export const talkKey=(id:string)=>`kontur:${id}:api`;
export class KonturService {
  private syncing=false;
  private cachedAdapter:{id:string;adapter:TalkAdapter}|null=null;
  constructor(private repository:TalkRepository,private store:SecureCredentialStore,private session:TalkSessionAccess,private progress:(value:KonturProgress)=>void=()=>{},private apiFetch:TalkFetch=fetch){}
  private async adapter(a:KonturAccount):Promise<TalkAdapter>{
    if(a.mode==='session')await this.session.ready(a.domain);
    if(this.cachedAdapter?.id===a.id)return this.cachedAdapter.adapter;
    let adapter:TalkAdapter;
    if(a.mode==='session'){const t=new TalkTransport(a.domain,this.session.fetch,()=>this.session.headers());adapter=new SessionTalkAdapter(a.domain,p=>t.get(p));}
    else{const secret=await this.store.get(talkKey(a.id));if(!secret)throw new KonturError('login','Ключ API Толка не сохранён. Подключите его снова.',401);const t=new TalkTransport(a.domain,this.apiFetch,()=>({'X-Auth-Token':secret}));adapter=new ApiTalkAdapter(a.domain,p=>t.get(p));}
    this.cachedAdapter={id:a.id,adapter};return adapter;
  }
  async open(domain:unknown):Promise<KonturResult>{try{await this.session.open(normalizeTalkDomain(domain));return{ok:true,message:'Войдите обычным способом в открытом окне Толка. Затем проверьте подключение.'};}catch(e){return{ok:false,message:safeKonturMessage(e)};}}
  async connect(input:KonturConnectInput):Promise<KonturResult>{
    if(this.syncing)return{ok:false,message:'Дождитесь обновления встреч.'};let stored:string|null=null;
    try{if(!input||!['api','session'].includes(input.mode))throw new KonturError('input','Выберите способ подключения Толка.');const domain=normalizeTalkDomain(input.domain);let identity;
      if(input.mode==='session'){await this.session.ready(domain);const t=new TalkTransport(domain,this.session.fetch,()=>this.session.headers());identity=await new SessionTalkAdapter(domain,p=>t.get(p)).identify();}
      else{if(typeof input.apiKey!=='string'||!input.apiKey.trim()||input.apiKey.length>4096||/[\r\n]/.test(input.apiKey))throw new KonturError('key','Укажите действующий ключ API Толка.');const t=new TalkTransport(domain,this.apiFetch,()=>({'X-Auth-Token':input.apiKey!.trim()}));identity=await new ApiTalkAdapter(domain,p=>t.get(p)).identify();}
      const id=createHash('sha256').update(`${domain}|${input.mode}|${identity.externalUserId??'api'}`).digest('hex');const existing=this.repository.getKonturAccount();const account:KonturAccount={id,domain,mode:input.mode,...identity,state:'connected',lastSyncAt:existing?.id===id?existing.lastSyncAt:null,error:null,meetingCount:existing?.id===id?existing.meetingCount:0};
      if(input.mode==='api'){await this.store.set(talkKey(id),input.apiKey!.trim());stored=id;}
      this.cachedAdapter=null;await this.repository.connectKontur(account);if(input.mode==='session')this.session.finishLogin?.();return{ok:true,message:'Толк подключён. Можно загрузить встречи.'};
    }catch(e){if(stored)await this.store.delete(talkKey(stored));return{ok:false,message:safeKonturMessage(e)};}
  }
  async sync():Promise<KonturResult>{
    if(this.syncing)return{ok:false,message:'Обновление уже выполняется.'};const account=this.repository.getKonturAccount();if(!account||account.state==='disconnected')return{ok:false,message:'Сначала подключите Толк.'};this.syncing=true;let run:string|null=null;
    try{run=await this.repository.startKonturSync(account.id);const adapter=await this.adapter(account);const identity=await adapter.identify();if(account.mode==='session'&&identity.externalUserId!==account.externalUserId)throw new KonturError('identity','В Толке выбран другой профиль. Подключите его отдельно.');const end=new Date().toISOString();const start=new Date(Date.parse(end)-90*86400_000).toISOString();this.progress({completed:0,total:0,message:'Получаем записи Толка…'});const records=await adapter.fetchMeetings(start,end,(completed,total)=>this.progress({completed,total,message:'Загружаем материалы встреч'}));await this.repository.commitKonturMeetings(account,records);await this.repository.finishKonturSync(run,'complete',records.length,null);const count=this.repository.getKonturAccount()?.meetingCount??0;return{ok:true,message:`Встречи обновлены: ${count}. Записей получено: ${records.length}.`};}
    catch(e){const message=safeKonturMessage(e);const needsLogin=e instanceof KonturError&&e.status===401;await this.repository.connectKontur({...account,state:needsLogin?'needs_login':'failed',error:message});if(run)await this.repository.finishKonturSync(run,'failed',0,message);return{ok:false,message};}finally{this.syncing=false;}
  }
  async disconnect(purge:unknown):Promise<KonturResult>{if(typeof purge!=='boolean')return{ok:false,message:'Неверные параметры отключения.'};if(this.syncing)return{ok:false,message:'Дождитесь обновления встреч.'};const account=this.repository.getKonturAccount();if(!account)return{ok:true,message:'Толк отключён.'};try{this.cachedAdapter=null;await this.session.clear();await this.store.delete(talkKey(account.id));await this.repository.disconnectKontur(purge);return{ok:true,message:purge?'Толк отключён. Локальные встречи удалены.':'Толк отключён. Сохранённые встречи доступны.'};}catch(e){return{ok:false,message:safeKonturMessage(e)};}}
}
