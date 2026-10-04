import {createHash} from 'node:crypto';
import {KonturError,normalizeTalkDomain} from './security.ts';
export type TalkFetch=(url:string,init:RequestInit)=>Promise<Response>;
const allowed=(path:string)=>/^\/api\/(context|conferencesHistory\/recent|recordings|recordings\/[A-Za-z0-9_-]+|recordings\/v2\/[A-Za-z0-9_-]+\/summary|Domain\/recordings\/v2|Domain\/recordings\/[A-Za-z0-9_-]+\/participants)$/.test(path);
export class TalkTransport {
  private cache=new Map<string,{etag:string;body:unknown}>();
  private scope='';
  constructor(private domain:string,private fetcher:TalkFetch,private headers:()=>Record<string,string>,private pause:(ms:number)=>Promise<void>=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {normalizeTalkDomain(domain);}
  async get(path:string):Promise<unknown>{
    const url=new URL(path,`https://${this.domain}`);if(url.hostname!==this.domain||url.protocol!=='https:'||url.username||url.password||url.hash||!allowed(url.pathname))throw new KonturError('path','Запрос к Толку отклонён.');
    const authorization=this.headers();const scope=createHash('sha256').update(JSON.stringify(authorization)).digest('hex');if(scope!==this.scope){this.cache.clear();this.scope=scope;}
    for(let attempt=0;attempt<3;attempt++){
      const cached=this.cache.get(url.href);
      let response:Response;try{response=await this.fetcher(url.href,{method:'GET',redirect:'error',headers:{Accept:'application/json',...authorization,...(cached?{'If-None-Match':cached.etag}:{})},signal:AbortSignal.timeout(20_000)});}catch{if(attempt<2){await this.pause(500*(attempt+1));continue;}throw new KonturError('network','Толк недоступен. Сохранённые встречи доступны.');}
      if(response.status===304&&cached)return cached.body;
      if(response.status===401)throw new KonturError('login','Сессия Толка истекла. Войдите снова.',401);
      if(response.status===403)throw new KonturError('forbidden','Недостаточно прав для чтения данных Толка.',403);
      if((response.status===429||response.status>=500)&&attempt<2){await this.pause(1000*(attempt+1));continue;}
      if(!response.ok)throw new KonturError('http','Толк не вернул данные. Сохранённый кэш не изменён.',response.status);
      if(!/json/i.test(response.headers.get('content-type')??'')||Number(response.headers.get('content-length')??0)>25_000_000)throw new KonturError('schema','Толк вернул неподдерживаемый ответ.');
      const reader=response.body?.getReader();if(!reader)throw new KonturError('schema','Пустой ответ Толка.');const chunks:Uint8Array[]=[];let bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>25_000_000){await reader.cancel();throw new KonturError('limit','Ответ Толка слишком большой.');}chunks.push(part.value);}}finally{reader.releaseLock();}
      try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));const etag=response.headers.get('etag');if(etag&&etag.length<500&&!/[\r\n]/.test(etag)){if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value!);this.cache.set(url.href,{etag,body});}return body;}catch{throw new KonturError('schema','Неверный JSON Толка.');}
    }throw new KonturError('network','Не удалось прочитать данные Толка.');
  }
}
